import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { sessionId?: string; turnCount?: number; ended?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { sessionId, turnCount, ended } = body;
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const updateData: any = {
    turn_count: typeof turnCount === "number" ? turnCount : 0
  };
  if (ended) {
    updateData.ended_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("chat_sessions")
    .update(updateData)
    .eq("id", sessionId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
