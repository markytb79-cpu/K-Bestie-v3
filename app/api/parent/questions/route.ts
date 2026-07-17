import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { filterParentQuestion } from "@/lib/plan/parentQuestionFilter";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const childId = req.nextUrl.searchParams.get("childId");
  if (!childId) {
    return NextResponse.json({ error: "childId required" }, { status: 400 });
  }

  const authCheck = await requireChildAccess(supabase, user.id, childId);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { childId: string; questionText: string; override?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { childId, questionText, override } = body;
  if (!childId || !questionText?.trim()) {
    return NextResponse.json({ error: "childId and questionText required" }, { status: 400 });
  }

  const authCheck = await requireChildAccess(supabase, user.id, childId);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const filterResult = filterParentQuestion(questionText.trim());
  if (filterResult.verdict === "block") {
    return NextResponse.json(
      { error: filterResult.reason, category: filterResult.category, suggestion: filterResult.suggestion },
      { status: 400 },
    );
  }
  if (filterResult.verdict === "suggest" && !override) {
    return NextResponse.json(
      {
        error: filterResult.reason,
        category: filterResult.category,
        suggestion: filterResult.suggestion,
        overridable: true,
      },
      { status: 422 },
    );
  }

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
