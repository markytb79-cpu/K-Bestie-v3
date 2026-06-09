import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/families/[id] — 가족 상세 (구성원 + 아이)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: family, error } = await supabase
    .from("families")
    .select(`
      id, name, created_by, created_at,
      family_members(id, user_id, role, joined_at),
      child_profiles(id, name, grade, interests, created_at)
    `)
    .eq("id", id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ family });
}

// PATCH /api/families/[id] — 가족 이름 수정 (오너만)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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

  const { data, error } = await createServiceClient()
    .from("families")
    .update({ name: name.trim() })
    .eq("id", id)
    .eq("created_by", user.id)
    .select("id, name")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ family: data });
}
