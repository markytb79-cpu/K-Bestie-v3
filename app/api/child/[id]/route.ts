import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { DEMO_CHILD } from "@/lib/demo-data";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 데모 ID: 정적 더미 반환
  if (id.startsWith("demo-")) {
    return NextResponse.json({
      id: DEMO_CHILD.id,
      name: DEMO_CHILD.name,
      grade: DEMO_CHILD.grade,
      interests: ["운동", "게임"],
    });
  }

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("pending_children")
      .select("id, name, grade, interests")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "아이 정보를 찾을 수 없어요" }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (id.startsWith("demo-")) {
    return NextResponse.json({ ok: true, _demo: true });
  }

  let body: { name?: string; grade?: string; interests?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (body.name?.trim()) updateData.name = body.name.trim();
  if (body.grade) updateData.grade = body.grade;
  if (Array.isArray(body.interests)) updateData.interests = body.interests;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "수정할 항목 없음" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("pending_children")
      .update(updateData)
      .eq("id", id);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "업데이트 실패" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (id.startsWith("demo-")) {
    return NextResponse.json({ ok: true, _demo: true });
  }

  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("pending_children")
      .delete()
      .eq("id", id);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "삭제 실패" }, { status: 500 });
  }
}
