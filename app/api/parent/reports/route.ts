import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const childId = req.nextUrl.searchParams.get("childId");
  if (!childId) {
    return NextResponse.json({ error: "childId required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const [{ data: child }, { data: sessions }] = await Promise.all([
    supabase.from("pending_children").select("name").eq("id", childId).single(),
    supabase
      .from("chat_sessions")
      .select("id, started_at, turn_count, ended_at")
      .eq("child_id", childId),
  ]);

  const sessionIds = (sessions ?? []).map((s) => s.id);
  const sessionMap = Object.fromEntries((sessions ?? []).map((s) => [s.id, s]));

  if (sessionIds.length === 0) {
    return NextResponse.json({ reports: [], childName: child?.name ?? null });
  }

  const { data: reports, error } = await supabase
    .from("daily_reports")
    .select("id, summary_line, mood_score, emotion_tags, parent_guide, created_at, session_id")
    .in("session_id", sessionIds)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const enriched = (reports ?? []).map((r) => ({
    ...r,
    session: sessionMap[r.session_id] ?? null,
  }));

  return NextResponse.json({ reports: enriched, childName: child?.name ?? null });
}
