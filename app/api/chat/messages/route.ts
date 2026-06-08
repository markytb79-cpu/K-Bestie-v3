import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
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

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("chat_messages")
    .insert({ session_id: sessionId, role, content: content.trim() });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
