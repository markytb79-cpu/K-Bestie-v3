import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { selectQuestions, parseGrade, type RoundType } from "@/lib/mission/selectQuestions";
import { getVoiceModeForChild } from "@/lib/plan/voiceMode";

export const runtime = "nodejs";

const VALID_ROUNDS: RoundType[] = ["round1_day", "round2_night", "common"];

export async function POST(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { childId?: string; roundType?: RoundType };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { childId, roundType } = body;
  if (!childId || !roundType) {
    return NextResponse.json({ error: "childId, roundType required" }, { status: 400 });
  }
  if (!VALID_ROUNDS.includes(roundType)) {
    return NextResponse.json({ error: "invalid roundType" }, { status: 400 });
  }

  const REQUIRED_COUNT = 5; // mission/answer의 완료 기준과 일치

  const service = createServiceClient();

  // 요금제(tier)별 음성 방식 — 미션 로직(정답판정/게이지/황금열쇠/라운드)과 무관한 부가 정보
  const { tier, voiceMode, liveVoiceName } = await getVoiceModeForChild(childId);

  // ── 이어하기: 아직 끝나지 않은(ended_at IS NULL) 같은 라운드의 미션 세션이 있으면
  // 새로 만들지 않고 그대로 이어서 반환한다. 예전엔 새로고침/재접속만 해도 무조건 새
  // 세션+진행상태를 만들어버려서 이전 대화·진행도가 통째로 사라졌음(중복 세션 문제).
  const { data: existingSession } = await service
    .from("chat_sessions")
    .select("id")
    .eq("child_id", childId)
    .eq("session_type", "mission")
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingSession) {
    const { data: existingProgress } = await service
      .from("mission_progress")
      .select("session_id, valid_answer_count, question_ids, question_states, round_type")
      .eq("session_id", existingSession.id)
      .eq("round_type", roundType)
      .maybeSingle();

    if (existingProgress && (existingProgress.valid_answer_count ?? 0) < REQUIRED_COUNT) {
      const existingIds: string[] = existingProgress.question_ids ?? [];
      const { data: existingQuestions } = await service
        .from("mission_questions")
        .select("id, question_text, dashboard_area_tag, cycle_type, round_type")
        .in("id", existingIds);

      const orderedExisting = existingIds
        .map((qid) => (existingQuestions ?? []).find((q) => q.id === qid))
        .filter(Boolean);

      return NextResponse.json({
        resumed: true,
        sessionId: existingSession.id,
        roundType,
        requiredCount: REQUIRED_COUNT,
        questionIds: existingIds,
        questions: orderedExisting,
        questionStates: existingProgress.question_states ?? {},
        validAnswerCount: existingProgress.valid_answer_count ?? 0,
        tier,
        voiceMode,
        liveVoiceName,
      });
    }
  }

  // 아이 학년 조회
  const { data: child, error: childErr } = await service
    .from("child_profiles")
    .select("id, grade")
    .eq("id", childId)
    .single();

  if (childErr || !child) {
    return NextResponse.json({ error: "Child not found" }, { status: 404 });
  }

  const grade = parseGrade(child.grade);
  if (grade === null) {
    return NextResponse.json({ error: "Cannot parse child grade" }, { status: 400 });
  }

  // 출제 질문 선별
  const questionIds = await selectQuestions(childId, grade, roundType);
  if (questionIds.length === 0) {
    return NextResponse.json({ error: "No eligible questions" }, { status: 409 });
  }

  // 미션 세션 생성 (session_type='mission')
  const { data: session, error: sessErr } = await service
    .from("chat_sessions")
    .insert({ child_id: childId, session_type: "mission" })
    .select("id")
    .single();

  if (sessErr || !session) {
    return NextResponse.json({ error: sessErr?.message ?? "Session insert failed" }, { status: 500 });
  }

  // mission_id 는 세션 id 로 지정 (미션=세션 1:1)
  await service.from("chat_sessions").update({ mission_id: session.id }).eq("id", session.id);

  // question_states 초기화 (전부 pending)
  const questionStates: Record<string, string> = {};
  for (const qid of questionIds) questionStates[qid] = "pending";

  const { error: progErr } = await service.from("mission_progress").insert({
    session_id: session.id,
    valid_answer_count: 0,
    question_ids: questionIds,
    question_states: questionStates,
    round_type: roundType,
  });

  if (progErr) {
    return NextResponse.json({ error: progErr.message }, { status: 500 });
  }

  // 출제이력 기록 (출제만, answer_status=NULL)
  const historyRows = questionIds.map((qid) => ({ child_id: childId, question_id: qid }));
  await service.from("mission_question_history").insert(historyRows);

  // 선택된 질문 문항 반환 (앞 5개=필수, 뒤 3개=예비)
  const { data: questions } = await service
    .from("mission_questions")
    .select("id, question_text, dashboard_area_tag, cycle_type, round_type")
    .in("id", questionIds);

  // questionIds 순서 유지
  const ordered = questionIds
    .map((qid) => (questions ?? []).find((q) => q.id === qid))
    .filter(Boolean);

  return NextResponse.json({
    resumed: false,
    sessionId: session.id,
    roundType,
    requiredCount: REQUIRED_COUNT,
    questionIds,
    questions: ordered,
    tier,
    voiceMode,
    liveVoiceName,
  });
}
