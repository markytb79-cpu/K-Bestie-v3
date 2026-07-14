import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// "일간 요약" — daily_reports.summary_line만 투영(read-time LLM 재호출 아님, 단순 필드 프로젝션).
// 모든 요금제(Care Start 포함)에 공통 제공되므로 상세 필드(dashboard_cards/parent_guide 등)는
// 절대 포함하지 않는다(필드 화이트리스트).
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const childId = req.nextUrl.searchParams.get("childId");
  if (!childId) {
    return NextResponse.json({ error: "childId required" }, { status: 400 });
  }

  const { data: sessions } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("child_id", childId);

  const sessionIds = (sessions ?? []).map((s) => s.id);
  if (sessionIds.length === 0) {
    return NextResponse.json({ summaries: [] });
  }

  // 필드 화이트리스트 — summary_line/mood_score/created_at만(상세 필드 제외).
  const { data: reports, error } = await supabase
    .from("daily_reports")
    .select("id, summary_line, mood_score, created_at")
    .in("session_id", sessionIds)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ summaries: reports ?? [] });
}
