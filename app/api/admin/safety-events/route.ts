import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

const EVENT_LIMIT = 200;

// GET /api/admin/safety-events?childId=xxx — chat_sessions을 거쳐 아이의 safety_events를 조회.
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const childId = req.nextUrl.searchParams.get("childId");
  if (!childId) {
    return NextResponse.json({ error: "childId required" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: sessions, error: sessionsError } = await service
    .from("chat_sessions")
    .select("id")
    .eq("child_id", childId);

  if (sessionsError) {
    return NextResponse.json({ error: sessionsError.message }, { status: 500 });
  }

  const sessionIds = (sessions ?? []).map((s) => s.id);
  if (sessionIds.length === 0) {
    return NextResponse.json({ events: [] });
  }

  const { data: events, error } = await service
    .from("safety_events")
    .select("id, session_id, subcategory, child_text, created_at, viewed_at")
    .in("session_id", sessionIds)
    .order("created_at", { ascending: false })
    .limit(EVENT_LIMIT);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ events: events ?? [] });
}
