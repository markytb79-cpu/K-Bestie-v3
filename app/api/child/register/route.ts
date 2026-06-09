import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { name: string; grade: string; interests: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, grade, interests } = body;
  if (!name?.trim() || !grade || !Array.isArray(interests) || interests.length === 0) {
    return NextResponse.json({ error: "name, grade, interests 필수" }, { status: 400 });
  }

  // 인증된 부모 ID 가져오기
  let parentId: string | null = null;
  let parentEmail = "";
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    parentId = user?.id ?? null;
    parentEmail = user?.email ?? "";
  } catch {}

  const supabase = createServiceClient();

  // 로그인 부모가 있으면 parents 행 보장 (트리거가 실행 안 된 기존 계정 대응)
  if (parentId) {
    const { error: upsertErr } = await supabase
      .from("parents")
      .upsert({ id: parentId, email: parentEmail }, { onConflict: "id", ignoreDuplicates: true });
    if (upsertErr) {
      return NextResponse.json({ error: "부모 계정 초기화 실패: " + upsertErr.message }, { status: 500 });
    }
  }

  const { data, error } = await supabase
    .from("pending_children")
    .insert({ name: name.trim(), grade, interests, ...(parentId ? { parent_id: parentId } : {}) })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: "아이 저장 실패: " + error.message }, { status: 500 });
  }

  return NextResponse.json({ childId: data.id });
}
