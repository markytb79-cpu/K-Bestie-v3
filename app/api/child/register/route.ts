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

  // 인증된 부모 ID 가져오기 (로그인 상태일 때만)
  let parentId: string | null = null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    parentId = user?.id ?? null;
  } catch {}

  try {
    const supabase = createServiceClient();
    const insertData: Record<string, unknown> = {
      name: name.trim(),
      grade,
      interests,
    };
    if (parentId) insertData.parent_id = parentId;

    const { data, error } = await supabase
      .from("pending_children")
      .insert(insertData)
      .select("id")
      .single();

    if (error) throw error;
    return NextResponse.json({ childId: data.id });
  } catch {
    // Supabase 미설정·에러 시 데모 ID 반환
    const demoId = `demo-child-${Date.now().toString(36)}`;
    return NextResponse.json({ childId: demoId, _demo: true });
  }
}
