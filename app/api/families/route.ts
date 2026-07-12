import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/families — 내 가족 목록 (구성원 포함)
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // joined_at 오름차순 — syncChildrenFromDB()가 families[0]을 "활성 가족"으로 선택하므로,
  // 온보딩 반복 버그 등으로 이후에 빈 중복 가족이 생겨도 항상 가장 먼저 가입한(진짜) 가족이
  // 선택되도록 순서를 고정한다.
  const { data, error } = await supabase
    .from("family_members")
    .select("family_id, role, joined_at, families(id, name, created_at)")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ families: data ?? [] });
}

// POST /api/families — 가족 생성 + 오너로 등록
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let name: string;
  try {
    ({ name } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!name?.trim()) return NextResponse.json({ error: "name 필수" }, { status: 400 });

  const svc = createServiceClient();

  const { data: family, error: famErr } = await svc
    .from("families")
    .insert({ name: name.trim(), created_by: user.id })
    .select("id, name, created_at")
    .single();
  if (famErr) return NextResponse.json({ error: famErr.message }, { status: 500 });

  const { error: memErr } = await svc
    .from("family_members")
    .insert({ family_id: family.id, user_id: user.id, role: "owner_parent" });
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

  return NextResponse.json({ family }, { status: 201 });
}
