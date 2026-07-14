import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// "주간 요약" 목록 — 모든 요금제 공통 제공. 필드 화이트리스트로 상세(detail_text/
// detail_dashboard_cards)는 절대 포함하지 않는다.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const childId = req.nextUrl.searchParams.get("childId");
  if (!childId) {
    return NextResponse.json({ error: "childId required" }, { status: 400 });
  }

  const { data: weeklies, error } = await supabase
    .from("weekly_summaries")
    .select("id, week_start, week_end, summary_text, mood_average, highlights, parent_guide, weekend_activity_recommendation, created_at")
    .eq("child_id", childId)
    .order("week_start", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ weeklySummaries: weeklies ?? [] });
}
