import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { selectQuestions, parseGrade, type RoundType } from "@/lib/mission/selectQuestions";

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

  const service = createServiceClient();

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
    sessionId: session.id,
    roundType,
    requiredCount: 5,
    questionIds,
    questions: ordered,
  });
}
