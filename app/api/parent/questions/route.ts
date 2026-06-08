import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const childId = req.nextUrl.searchParams.get("childId");
  if (!childId) {
    return NextResponse.json({ error: "childId required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: questions, error } = await supabase
    .from("parent_questions")
    .select("id, question_text, status, created_at, delivered_count")
    .eq("child_id", childId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ questions: questions ?? [] });
}

export async function POST(req: NextRequest) {
  let body: { childId: string; questionText: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { childId, questionText } = body;
  if (!childId || !questionText?.trim()) {
    return NextResponse.json({ error: "childId and questionText required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("parent_questions")
    .insert({ child_id: childId, question_text: questionText.trim() })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ questionId: data.id });
}
