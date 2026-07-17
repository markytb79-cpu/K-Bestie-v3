import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { validateAnswer } from "@/lib/mission/validateAnswer";
import { earnMissionCompleteKey } from "@/lib/goldkey/ledger";
import { checkConsentForChild } from "@/lib/plan/consentGuard";
import { isQuestionEngineV2Enabled } from "@/lib/questions/feature-flags";
import { classifyAnswer } from "@/lib/questions/answer-classifier";
import { pickReaction } from "@/lib/freeChatReactions";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

const REQUIRED_COUNT = 5; // V1 게이지 완료 기준 (유효답변 5칸)

type QuestionState = "pending" | "answered" | "skipped" | "refused";

// childTurnId 기준 인메모리 캐시 추가
const answerCache = new Map<string, { response: any; ts: number }>();
const ANSWER_CACHE_TTL_MS = 15_000;

function getCachedAnswer(key: string): any | null {
  const hit = answerCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > ANSWER_CACHE_TTL_MS) {
    answerCache.delete(key);
    return null;
  }
  return hit.response;
}

function setCachedAnswer(key: string, response: any) {
  if (answerCache.size > 200) {
    const oldestKey = answerCache.keys().next().value;
    if (oldestKey) answerCache.delete(oldestKey);
  }
  answerCache.set(key, { response, ts: Date.now() });
}

export async function POST(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { sessionId?: string; questionId?: string; answerText?: string; childTurnId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sessionId, questionId, answerText, childTurnId } = body;
  if (!sessionId || !questionId || typeof answerText !== "string") {
    return NextResponse.json({ error: "sessionId, questionId, answerText required" }, { status: 400 });
  }

  // answerText 길이 제한 (500자)
  if (answerText.length > 500) {
    return NextResponse.json({ error: "answerText too long (max 500 characters)" }, { status: 400 });
  }

  // 중복 요청 캐시 확인
  if (childTurnId) {
    const cached = getCachedAnswer(childTurnId);
    if (cached !== null) {
      return NextResponse.json(cached);
    }
  }

  const service = createServiceClient();

  // 세션 조회 + 자유대화 세션 거부 (판정 로직은 미션 세션 전용)
  const { data: session, error: sessErr } = await service
    .from("chat_sessions")
    .select("id, session_type, child_id")
    .eq("id", sessionId)
    .single();

  if (sessErr || !session) {
    console.error("[answer/route] Session query failed:", sessErr);
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const authCheck = await requireChildAccess(service, user.id, session.child_id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.session_type !== "mission") {
    return NextResponse.json(
      { error: "answer validation is only allowed for mission sessions" },
      { status: 400 }
    );
  }

  const consentBlocked = await checkConsentForChild(session.child_id);
  if (consentBlocked) return consentBlocked;

  // 기능 플래그 및 코호트 체크 (진행상태 로드 전으로 당김)
  const isV2 = isQuestionEngineV2Enabled(session.child_id);

  interface MissionProgressRow {
    session_id: string;
    valid_answer_count: number | null;
    question_ids: string[] | null;
    question_states: Record<string, QuestionState> | null;
    status?: string | null;
    updated_at?: string | null;
  }

  // isV2 여부에 따라 select fields 분리 (V1 경로에서 신규 컬럼 select 방지)
  const fields = isV2
    ? "session_id, valid_answer_count, question_ids, question_states, status"
    : "session_id, valid_answer_count, question_ids, question_states";

  // 진행상태 로드
  const { data: progress, error: progErr } = (await service
    .from("mission_progress")
    .select(fields)
    .eq("session_id", sessionId)
    .single()) as unknown as { data: MissionProgressRow | null; error: { message: string } | null };

  if (progErr || !progress) {
    console.error("[answer/route] progress query failed:", progErr);
    return NextResponse.json({ error: "Mission progress not found" }, { status: 404 });
  }

  // SAFETY_PAUSED 또는 COMPLETED 상태인 경우 423으로 즉시 반환하며 차단
  if (isV2 && (progress.status === "SAFETY_PAUSED" || progress.status === "COMPLETED")) {
    const resPayload = { error: "Mission is already completed or safety paused", status: progress.status };
    if (childTurnId) setCachedAnswer(childTurnId, resPayload);
    return NextResponse.json(resPayload, { status: 423 });
  }

  const questionIds: string[] = progress.question_ids ?? [];
  if (!questionIds.includes(questionId)) {
    return NextResponse.json({ error: "questionId not part of this mission" }, { status: 400 });
  }

  const states: Record<string, QuestionState> = { ...(progress.question_states ?? {}) };
  const prevState = states[questionId] ?? "pending";

  if (isV2) {
    // ------------------ 신규 V2 질문엔진 로직 ------------------
    
    // 현재까지 asked_order가 세팅된 행의 개수 조회
    const { count: askedCount, error: askedCountErr } = await service
      .from("mission_question_history")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .not("asked_order", "is", null);

    if (askedCountErr) {
      console.error("[answer/route] Failed to count asked_order:", askedCountErr);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    // 해당 질문의 사전선택 행을 찾아서 asked_order와 asked_at을 업데이트
    const { error: updOrderErr } = await service
      .from("mission_question_history")
      .update({
        asked_order: (askedCount ?? 0) + 1,
        asked_at: new Date().toISOString(),
      })
      .eq("session_id", sessionId)
      .eq("question_id", questionId)
      .is("asked_order", null);

    if (updOrderErr) {
      console.error("[answer/route] Failed to update asked_order and asked_at:", updOrderErr);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    // 질문 텍스트 조회
    const { data: qData, error: qDataErr } = await service
      .from("mission_questions")
      .select("question_text")
      .eq("id", questionId)
      .single();
    
    if (qDataErr) {
      console.error("[answer/route] Failed to fetch question text:", qDataErr);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
    const questionText = qData?.question_text ?? "";

    const classification = await classifyAnswer(questionText, answerText);

    // 1. SAFETY_SIGNAL 판정 시 즉시 중단 처리
    if (classification === "SAFETY_SIGNAL") {
      const { error: updProgErr } = await service
        .from("mission_progress")
        .update({
          status: "SAFETY_PAUSED",
          updated_at: new Date().toISOString(),
        })
        .eq("session_id", sessionId);

      if (updProgErr) {
        console.error("[answer/route] Failed to update progress to SAFETY_PAUSED:", updProgErr);
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }

      // 이번 질문 이력에 SAFETY_SIGNAL 기록 (asked_order는 현재 턴의 순번을 넣어줄 수 있으나 일단 Null 또는 기존 값 유지)
      const { data: histRow, error: histRowErr } = await service
        .from("mission_question_history")
        .insert({
          child_id: session.child_id,
          question_id: questionId,
          answer_status: "skipped",
          answer_classification: "SAFETY_SIGNAL",
          session_id: sessionId,
        })
        .select("id")
        .single();

      if (histRowErr) {
        console.error("[answer/route] Failed to insert safety history:", histRowErr);
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }

      // 남은 사전선택 질문 UNUSED 마킹 -> termination_reason: "SAFETY_PAUSED" (요구사항 3, 4)
      const { error: markErr } = await service
        .from("mission_question_history")
        .update({ termination_reason: "SAFETY_PAUSED" })
        .eq("child_id", session.child_id)
        .eq("session_id", sessionId)
        .eq("question_role", "RESERVE")
        .is("asked_order", null);

      if (markErr) {
        console.error("[answer/route] Failed to mark unused questions as SAFETY_PAUSED:", markErr);
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }

      // safety_events 기록 호출 (source=QUESTION_ENGINE 태그 포함)
      const reaction = pickReaction(answerText);
      const { error: safetyEventErr } = await service.from("safety_events").insert({
        session_id: sessionId,
        subcategory: reaction.safetySubcategory || "violence",
        child_text: answerText,
        source: "QUESTION_ENGINE",
        child_id: session.child_id,
        question_history_id: histRow?.id ?? null,
      });

      if (safetyEventErr) {
        console.error("[answer/route] Failed to insert safety event:", safetyEventErr);
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }

      const resPayload = {
        valid: false,
        reason: "safety_signal",
        refused: false,
        previousState: prevState,
        questionState: "skipped" as const,
        validAnswerCount: progress.valid_answer_count ?? 0,
        progressPercent: (progress.valid_answer_count ?? 0) * 10,
        requiredCount: 10,
        completed: false,
        engine_version: "v2",
        questionStates: states,
      };

      if (childTurnId) setCachedAnswer(childTurnId, resPayload);
      return NextResponse.json(resPayload);
    }

    let newState: QuestionState;
    let answerStatus: "answered" | "skipped" | "refused";

    if (classification === "VALID") {
      newState = "answered";
      answerStatus = "answered";
    } else if (classification === "REFUSAL") {
      newState = "refused";
      answerStatus = "refused";
    } else if (classification === "NO_RESPONSE") {
      newState = "skipped";
      answerStatus = "skipped";
    } else {
      // PARTIAL 인 경우: 꼬리질문 1회 시도
      const { data: histList, error: histListErr } = await service
        .from("mission_question_history")
        .select("id")
        .eq("child_id", session.child_id)
        .eq("session_id", sessionId)
        .eq("question_id", questionId)
        .eq("follow_up_used", true);

      if (histListErr) {
        console.error("[answer/route] Failed to fetch follow-up history:", histListErr);
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }

      const alreadyUsedFollowUp = histList && histList.length > 0;

      if (!alreadyUsedFollowUp) {
        // 아직 꼬리질문 1회 시도 전: 꼬리질문 사용 마킹하고, 상태 pending으로 응답해 같은 질문 1회 재도전
        newState = "pending";
        answerStatus = "skipped";

        const { error: insertPartialErr } = await service.from("mission_question_history").insert({
          child_id: session.child_id,
          question_id: questionId,
          answer_status: answerStatus,
          answer_classification: "PARTIAL",
          follow_up_used: true,
          session_id: sessionId,
        });

        if (insertPartialErr) {
          console.error("[answer/route] Failed to insert PARTIAL followup history:", insertPartialErr);
          return NextResponse.json({ error: "Database error" }, { status: 500 });
        }

        const resPayload = {
          valid: false,
          reason: "partial_followup",
          refused: false,
          previousState: prevState,
          questionState: newState,
          validAnswerCount: progress.valid_answer_count ?? 0,
          progressPercent: (progress.valid_answer_count ?? 0) * 10,
          requiredCount: 10,
          completed: false,
          engine_version: "v2",
          questionStates: states,
        };

        if (childTurnId) setCachedAnswer(childTurnId, resPayload);
        return NextResponse.json(resPayload);
      } else {
        // 이미 꼬리질문 1회 완료 상태에서 또 VALID 획득 실패 -> 최종 실패
        newState = "skipped";
        answerStatus = "skipped";
      }
    }

    // answered -> skipped/refused 등 역전 시 progress_awarded 복구
    if (prevState === "answered" && newState !== "answered") {
      const { error: rollbackAwardedErr } = await service
        .from("mission_question_history")
        .update({ progress_awarded: false })
        .eq("child_id", session.child_id)
        .eq("session_id", sessionId)
        .eq("question_id", questionId)
        .eq("progress_awarded", true);

      if (rollbackAwardedErr) {
        console.error("[answer/route] Failed to rollback progress_awarded:", rollbackAwardedErr);
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }
    }

    // progress_awarded 계산
    const progressAwarded = prevState !== "answered" && newState === "answered";

    // 이번 질문 이력 기록
    const { error: histInsertErr } = await service.from("mission_question_history").insert({
      child_id: session.child_id,
      question_id: questionId,
      answer_status: answerStatus,
      answer_classification: classification,
      progress_awarded: progressAwarded,
      session_id: sessionId,
    });

    if (histInsertErr) {
      console.error("[answer/route] Failed to insert question history:", histInsertErr);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    states[questionId] = newState;

    // V2 진행률 계산: answer_classification & progress_awarded 기준 (요구사항 5)
    const { data: awardedRows, error: countErr } = await service
      .from("mission_question_history")
      .select("id")
      .eq("session_id", sessionId)
      .eq("answer_classification", "VALID")
      .eq("progress_awarded", true);

    if (countErr) {
      console.error("[answer/route] Failed to count awarded progress:", countErr);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    const validCount = awardedRows ? awardedRows.length : 0;
    const wasCompletedV2 = progress.status === "COMPLETED";
    const completedV2 = validCount >= 10;
    const isFinalCompleted = completedV2 && !wasCompletedV2;

    let currentProgress = progress;
    let currentStates = states;
    let success = false;
    let finalValidCount = validCount;
    let finalCompletedV2 = completedV2;
    let finalIsFinalCompleted = isFinalCompleted;

    for (let attempt = 0; attempt < 3; attempt++) {
      const updatePayload: any = {
        question_states: currentStates,
        valid_answer_count: finalValidCount,
        updated_at: new Date().toISOString(),
      };
      if (finalCompletedV2) {
        updatePayload.status = "COMPLETED";
      }

      let query = service
        .from("mission_progress")
        .update(updatePayload)
        .eq("session_id", sessionId);

      if (currentProgress.valid_answer_count === null) {
        query = query.is("valid_answer_count", null);
      } else {
        query = query.eq("valid_answer_count", currentProgress.valid_answer_count);
      }
      
      query = query.neq("status", "COMPLETED");

      const { data: updatedRows, error: updateErr } = await query.select("session_id");

      if (updateErr) {
        console.error(`[answer/route] Failed to update progress (attempt ${attempt + 1}):`, updateErr);
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }

      if (updatedRows && updatedRows.length > 0) {
        success = true;
        break;
      }

      console.warn(`[answer/route] Optimistic lock conflict on mission_progress update. Retrying... (attempt ${attempt + 1})`);

      const { data: latestProgress, error: fetchErr } = await service
        .from("mission_progress")
        .select("session_id, valid_answer_count, question_ids, question_states, status")
        .eq("session_id", sessionId)
        .single();

      if (fetchErr || !latestProgress) {
        console.error("[answer/route] Failed to refetch latest progress during retry:", fetchErr);
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }

      if (latestProgress.status === "SAFETY_PAUSED" || latestProgress.status === "COMPLETED") {
        return NextResponse.json({ error: "Mission is already completed or safety paused", status: latestProgress.status }, { status: 423 });
      }

      currentProgress = latestProgress;
      currentStates = { ...(latestProgress.question_states ?? {}), [questionId]: newState };

      const { data: awardedRows, error: retryCountErr } = await service
        .from("mission_question_history")
        .select("id")
        .eq("session_id", sessionId)
        .eq("answer_classification", "VALID")
        .eq("progress_awarded", true);

      if (retryCountErr) {
        console.error("[answer/route] Failed to count awarded progress on retry:", retryCountErr);
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }

      finalValidCount = awardedRows ? awardedRows.length : 0;
      const wasCompletedV2 = latestProgress.status === "COMPLETED";
      finalCompletedV2 = finalValidCount >= 10;
      finalIsFinalCompleted = finalCompletedV2 && !wasCompletedV2;
    }

    if (!success) {
      console.error("[answer/route] Optimistic lock update failed after 3 attempts due to conflict.");
      return NextResponse.json({ error: "Transaction conflict, please try again" }, { status: 409 });
    }

    // 실패(skipped/refused)인 경우 예비질문 승격 로직
    if (newState === "skipped" || newState === "refused") {
      const { data: reserveList, error: reserveErr } = await service
        .from("mission_question_history")
        .select("id, question_id, selected_order")
        .eq("child_id", session.child_id)
        .eq("session_id", sessionId)
        .eq("question_role", "RESERVE")
        .is("asked_order", null)
        .order("selected_order", { ascending: true })
        .limit(1);

      if (reserveErr) {
        console.error("[answer/route] Failed to query reserve questions:", reserveErr);
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }

      if (reserveList && reserveList.length > 0) {
        const reserveQ = reserveList[0];
        
        // 현재 질문의 selected_order 조회
        const { data: failedQ, error: failedQErr } = await service
          .from("mission_question_history")
          .select("selected_order")
          .eq("child_id", session.child_id)
          .eq("session_id", sessionId)
          .eq("question_id", questionId)
          .order("selected_order", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (failedQErr) {
          console.error("[answer/route] Failed to query failed question order:", failedQErr);
          return NextResponse.json({ error: "Database error" }, { status: 500 });
        }

        const currentOrder = failedQ?.selected_order ?? 0;

        // 이후의 selected_order들 1씩 밀기
        const { data: shiftList, error: shiftListErr } = await service
          .from("mission_question_history")
          .select("id, selected_order")
          .eq("child_id", session.child_id)
          .eq("session_id", sessionId)
          .gt("selected_order", currentOrder);

        if (shiftListErr) {
          console.error("[answer/route] Failed to query shift list:", shiftListErr);
          return NextResponse.json({ error: "Database error" }, { status: 500 });
        }

        if (shiftList) {
          for (const row of shiftList) {
            const { error: shiftErr } = await service
              .from("mission_question_history")
              .update({ selected_order: row.selected_order + 1 })
              .eq("id", row.id);

            if (shiftErr) {
              console.error("[answer/route] Failed to update shift order:", shiftErr);
              return NextResponse.json({ error: "Database error" }, { status: 500 });
            }
          }
        }

        // RESERVE -> PRIMARY 승격 및 순서 삽입
        const { error: promoteErr } = await service
          .from("mission_question_history")
          .update({
            question_role: "PRIMARY",
            selected_order: currentOrder + 1,
            asked_at: new Date().toISOString(),
          })
          .eq("id", reserveQ.id);

        if (promoteErr) {
          console.error("[answer/route] Failed to promote reserve question:", promoteErr);
          return NextResponse.json({ error: "Database error" }, { status: 500 });
        }

        // progress.question_ids 정렬 갱신
        const { data: sortedList, error: sortedErr } = await service
          .from("mission_question_history")
          .select("question_id")
          .eq("child_id", session.child_id)
          .eq("session_id", sessionId)
          .order("selected_order", { ascending: true });

        if (sortedErr) {
          console.error("[answer/route] Failed to query sorted questions:", sortedErr);
          return NextResponse.json({ error: "Database error" }, { status: 500 });
        }

        if (sortedList) {
          const sortedIds = sortedList.map((h) => h.question_id);
          const newStates = { ...states };
          newStates[reserveQ.question_id] = "pending";

          const { error: updateIdsErr } = await service
            .from("mission_progress")
            .update({
              question_ids: sortedIds,
              question_states: newStates,
            })
            .eq("session_id", sessionId);

          if (updateIdsErr) {
            console.error("[answer/route] Failed to update sorted ids in progress:", updateIdsErr);
            return NextResponse.json({ error: "Database error" }, { status: 500 });
          }
        }
      }
    }

    // 멱등성 보장 골드키 지급 및 수동 롤백 (요구사항 6)
    if (isFinalCompleted) {
      // 남은 사전선택 질문 UNUSED 마킹 -> termination_reason: "COMPLETED" (요구사항 3, 4)
      const { error: unusedErr } = await service
        .from("mission_question_history")
        .update({ termination_reason: "COMPLETED" })
        .eq("child_id", session.child_id)
        .eq("session_id", sessionId)
        .eq("question_role", "RESERVE")
        .is("asked_order", null);

      if (unusedErr) {
        console.error("[answer/route] Failed to mark unused questions as COMPLETED:", unusedErr);
        // 롤백: progress status를 이전 상태로 롤백
        await service
          .from("mission_progress")
          .update({
            status: progress.status,
            question_states: progress.question_states,
            valid_answer_count: progress.valid_answer_count,
            updated_at: progress.updated_at,
          })
          .eq("session_id", sessionId);

        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }

      try {
        const goldKeyResult = await earnMissionCompleteKey(session.child_id, sessionId, "mission_complete");
        if (!goldKeyResult.earned && goldKeyResult.reason !== "already_earned") {
          throw new Error(goldKeyResult.reason || "unknown_error");
        }
      } catch (goldKeyErr) {
        console.error("[answer/route] earnMissionCompleteKey error, rolling back progress and unused update:", goldKeyErr);
        // 롤백: progress status를 이전 상태로 롤백
        await service
          .from("mission_progress")
          .update({
            status: progress.status,
            question_states: progress.question_states,
            valid_answer_count: progress.valid_answer_count,
            updated_at: progress.updated_at,
          })
          .eq("session_id", sessionId);

        // 롤백: termination_reason을 null로 원복
        await service
          .from("mission_question_history")
          .update({ termination_reason: null })
          .eq("child_id", session.child_id)
          .eq("session_id", sessionId)
          .eq("termination_reason", "COMPLETED");

        return NextResponse.json({ error: "Failed to award gold key" }, { status: 500 });
      }
    }

    const resPayload = {
      valid: classification === "VALID",
      reason: classification !== "VALID" ? classification : null,
      refused: classification === "REFUSAL",
      previousState: prevState,
      questionState: newState,
      validAnswerCount: validCount,
      progressPercent: validCount * 10,
      requiredCount: 10,
      completed: completedV2,
      engine_version: "v2",
      questionStates: states,
    };

    if (childTurnId) setCachedAnswer(childTurnId, resPayload);
    return NextResponse.json(resPayload);
  }

  // ------------------ 기존 V1 질문엔진 로직 ------------------
  
  // 유효성 판정
  const result = validateAnswer(answerText);

  let newState: QuestionState;
  let answerStatus: "answered" | "skipped" | "refused";
  if (result.valid) {
    newState = "answered";
    answerStatus = "answered";
  } else if (result.refused) {
    newState = "refused";
    answerStatus = "refused";
  } else {
    // 무응답/회피/오답 → 완료처리 없이 skipped (전체 순회 후 루프백 대상)
    newState = "skipped";
    answerStatus = "skipped";
  }

  states[questionId] = newState;

  // valid_answer_count 재계산 (answered 상태 개수, 최대 questionIds 길이)
  const validCount = Object.entries(states).filter(
    ([qid, st]) => questionIds.includes(qid) && st === "answered"
  ).length;

  // 출제이력 기록 (이번 답변)
  await service.from("mission_question_history").insert({
    child_id: session.child_id,
    question_id: questionId,
    answer_status: answerStatus,
  });

    let currentProgressV1 = progress;
    let currentStatesV1 = states;
    let successV1 = false;
    let finalValidCountV1 = validCount;

    for (let attempt = 0; attempt < 3; attempt++) {
      const updatePayload = {
        question_states: currentStatesV1,
        valid_answer_count: finalValidCountV1,
        updated_at: new Date().toISOString(),
      };

      let query = service
        .from("mission_progress")
        .update(updatePayload)
        .eq("session_id", sessionId);

      if (currentProgressV1.valid_answer_count === null) {
        query = query.is("valid_answer_count", null);
      } else {
        query = query.eq("valid_answer_count", currentProgressV1.valid_answer_count);
      }

      const { data: updatedRows, error: updErr } = await query.select("session_id");

      if (updErr) {
        console.error(`[answer/route] V1 progress update failed (attempt ${attempt + 1}):`, updErr);
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }

      if (updatedRows && updatedRows.length > 0) {
        successV1 = true;
        break;
      }

      console.warn(`[answer/route] V1 optimistic lock conflict. Retrying... (attempt ${attempt + 1})`);

      const { data: latestProgressV1, error: fetchErr } = await service
        .from("mission_progress")
        .select("session_id, valid_answer_count, question_ids, question_states")
        .eq("session_id", sessionId)
        .single();

      if (fetchErr || !latestProgressV1) {
        console.error("[answer/route] V1 failed to refetch progress during retry:", fetchErr);
        return NextResponse.json({ error: "Database error" }, { status: 500 });
      }

      currentProgressV1 = latestProgressV1;
      currentStatesV1 = { ...(latestProgressV1.question_states ?? {}), [questionId]: newState };
      
      finalValidCountV1 = Object.entries(currentStatesV1).filter(
        ([qid, st]) => questionIds.includes(qid) && st === "answered"
      ).length;
    }

    if (!successV1) {
      console.error("[answer/route] V1 progress update failed after 3 attempts due to conflict.");
      return NextResponse.json({ error: "Transaction conflict, please try again" }, { status: 409 });
    }

  const wasCompleted = (progress.valid_answer_count ?? 0) >= REQUIRED_COUNT;
  const completed = validCount >= REQUIRED_COUNT;

  // 게이지 5칸 최초 달성 시점에만 황금열쇠 적립 (재호출로 중복 적립 방지)
  if (completed && !wasCompleted) {
    try {
      const goldKeyResult = await earnMissionCompleteKey(session.child_id);
      if (!goldKeyResult.earned && goldKeyResult.reason !== "already_earned") {
        throw new Error(goldKeyResult.reason || "unknown_error");
      }
    } catch (e) {
      console.error("[answer/route] V1 earnMissionCompleteKey error:", e);
      // 적립 실패는 미션 완료 응답 자체를 막지 않음 (열쇠는 부가 보상)
    }
  }

  const resPayload = {
    valid: result.valid,
    reason: result.reason ?? null,
    refused: result.refused ?? false,
    previousState: prevState,
    questionState: newState,
    validAnswerCount: validCount,   // 게이지 0~5
    progressPercent: validCount * 20,
    requiredCount: REQUIRED_COUNT,
    completed,
    engine_version: "v1",
    questionStates: states,
  };

  if (childTurnId) setCachedAnswer(childTurnId, resPayload);
  return NextResponse.json(resPayload);
}
