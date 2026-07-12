import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 리포트+세션을 한 번의 쿼리로 조회 — 예전엔 두 번 순차 조회(리포트 → 세션)해서
  // 왕복이 하나 더 걸렸음(상세 화면 진입 시 스켈레톤이 길게 보이던 원인 중 하나).
  const { data: report, error } = await supabase
    .from("daily_reports")
    .select(
      "id, summary_line, mood_score, emotion_tags, parent_guide, emotion_level, dashboard_cards, created_at, session_id, chat_sessions(started_at, turn_count, ended_at)"
    )
    .eq("id", id)
    .single();

  if (error || !report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const { chat_sessions, ...rest } = report as typeof report & {
    chat_sessions: { started_at: string; turn_count: number; ended_at: string | null } | null;
  };

  return NextResponse.json({ report: { ...rest, session: chat_sessions ?? null } });
}
