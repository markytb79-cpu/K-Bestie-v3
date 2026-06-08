import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { sessionId?: string; turnCount?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { sessionId, turnCount } = body;
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const supabase = createServiceClient();
  // ended_at은 찍지 않음 — 세션을 재개 가능 상태로 유지
  const { error } = await supabase
    .from("chat_sessions")
    .update({ turn_count: typeof turnCount === "number" ? turnCount : 0 })
    .eq("id", sessionId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
