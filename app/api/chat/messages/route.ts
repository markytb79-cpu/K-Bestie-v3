import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { sessionId?: string; role?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sessionId, role, content } = body;
  if (!sessionId || !role || !content?.trim()) {
    return NextResponse.json({ error: "sessionId, role, content required" }, { status: 400 });
  }
  if (role !== "child" && role !== "k") {
    return NextResponse.json({ error: "role must be child or k" }, { status: 400 });
  }

  const { data: session, error: sessionError } = await supabase
    .from("chat_sessions")
    .select("id, session_type")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const service = createServiceClient();
  const { error } = await service
    .from("chat_messages")
    .insert({ session_id: sessionId, role, content: content.trim() });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
