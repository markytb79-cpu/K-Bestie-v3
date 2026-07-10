import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { validateAnswer } from "@/lib/mission/validateAnswer";
import { earnMissionCompleteKey } from "@/lib/goldkey/ledger";

export const runtime = "nodejs";

const REQUIRED_COUNT = 5; // 게이지 완료 기준 (유효답변 5칸)

type QuestionState = "pending" | "answered" | "skipped" | "refused";

export async function POST(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { sessionId?: string; questionId?: string; answerText?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sessionId, questionId, answerText } = body;
  if (!sessionId || !questionId || typeof answerText !== "string") {
    return NextResponse.json({ error: "sessionId, questionId, answerText required" }, { status: 400 });
  }

  const service = createServiceClient();

  // 세션 조회 + 자유대화 세션 거부 (판정 로직은 미션 세션 전용)
  const { data: session, error: sessErr } = await service
    .from("chat_sessions")
    .select("id, session_type, child_id")
    .eq("id", sessionId)
    .single();

  if (sessErr || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.session_type !== "mission") {
    return NextResponse.json(
      { error: "answer validation is only allowed for mission sessions" },
      { status: 400 }
    );
  }

  // 진행상태 로드
  const { data: progress, error: progErr } = await service
    .from("mission_progress")
    .select("session_id, valid_answer_count, question_ids, question_states")
    .eq("session_id", sessionId)
    .single();

  if (progErr || !progress) {
    return NextResponse.json({ error: "Mission progress not found" }, { status: 404 });
  }

  const questionIds: string[] = progress.question_ids ?? [];
  if (!questionIds.includes(questionId)) {
    return NextResponse.json({ error: "questionId not part of this mission" }, { status: 400 });
  }

  const states: Record<string, QuestionState> = { ...(progress.question_states ?? {}) };
  const prevState = states[questionId] ?? "pending";

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

  // 진행상태 갱신
  const { error: updErr } = await service
    .from("mission_progress")
    .update({
      question_states: states,
      valid_answer_count: validCount,
      updated_at: new Date().toISOString(),
    })
    .eq("session_id", sessionId);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  const wasCompleted = (progress.valid_answer_count ?? 0) >= REQUIRED_COUNT;
  const completed = validCount >= REQUIRED_COUNT;

  // 게이지 5칸 최초 달성 시점에만 황금열쇠 적립 (재호출로 중복 적립 방지)
  if (completed && !wasCompleted) {
    try {
      await earnMissionCompleteKey(session.child_id);
    } catch {
      // 적립 실패는 미션 완료 응답 자체를 막지 않음 (열쇠는 부가 보상)
    }
  }

  return NextResponse.json({
    valid: result.valid,
    reason: result.reason ?? null,
    refused: result.refused ?? false,
    previousState: prevState,
    questionState: newState,
    validAnswerCount: validCount,   // 게이지 0~5
    requiredCount: REQUIRED_COUNT,
    completed,
    questionStates: states,
  });
}
