import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import type { UsageKind } from "@/lib/plan/pricing";

export const runtime = "nodejs";

const EVENT_LIMIT = 500;

// GET /api/admin/usage?childId=xxx&from=ISO&to=ISO — 아이별 usage_events 목록 + kind별 집계.
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const childId = req.nextUrl.searchParams.get("childId");
  if (!childId) {
    return NextResponse.json({ error: "childId required" }, { status: 400 });
  }
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");

  const service = createServiceClient();
  let query = service
    .from("usage_events")
    .select("id, tier, voice_mode, kind, duration_sec, char_count, est_cost_krw, created_at, ended_at")
    .eq("child_id", childId)
    .order("created_at", { ascending: false });

  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  const { data: events, error } = await query.limit(EVENT_LIMIT);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const summary: Record<UsageKind, number> & { totalCostKrw: number } = {
    stt: 0,
    tts: 0,
    live_audio: 0,
    llm: 0,
    totalCostKrw: 0,
  };
  for (const e of events ?? []) {
    summary.totalCostKrw += e.est_cost_krw ?? 0;
    if (e.kind in summary) summary[e.kind as UsageKind] += 1;
  }

  return NextResponse.json({ events: events ?? [], summary });
}
