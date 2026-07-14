import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTierForChild, isDetailAllowed } from "@/lib/plan/requireDetailAccess";

export const runtime = "nodejs";

// "주간 상세" — Care Start에는 detail_text/detail_dashboard_cards를 서버측에서 스트리핑하고
// restricted:true를 함께 내려준다(요약 필드는 그대로, 상세 필드만 API 직접 호출로도 새어나가지 않음).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: weekly, error } = await supabase
    .from("weekly_summaries")
    .select("id, child_id, week_start, week_end, summary_text, detail_text, detail_dashboard_cards, mood_average, highlights, parent_guide, weekend_activity_recommendation, created_at")
    .eq("id", id)
    .single();

  if (error || !weekly) {
    return NextResponse.json({ error: "Weekly report not found" }, { status: 404 });
  }

  const tier = await getTierForChild(weekly.child_id);
  const restricted = !isDetailAllowed(tier);
  const safeWeekly = restricted ? { ...weekly, detail_text: "", detail_dashboard_cards: {} } : weekly;

  return NextResponse.json({ weeklySummary: safeWeekly, restricted });
}
