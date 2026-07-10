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

  const { data: report, error } = await supabase
    .from("daily_reports")
    .select("id, summary_line, mood_score, emotion_tags, parent_guide, emotion_level, dashboard_cards, created_at, session_id")
    .eq("id", id)
    .single();

  if (error || !report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const { data: session } = await supabase
    .from("chat_sessions")
    .select("started_at, turn_count, ended_at")
    .eq("id", report.session_id)
    .single();

  return NextResponse.json({ report: { ...report, session: session ?? null } });
}
