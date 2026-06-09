import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/families/[id]/children — 가족 아이 목록
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("child_profiles")
    .select("id, name, grade, interests, created_at")
    .eq("family_id", id)
    .order("created_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ children: data ?? [] });
}

// POST /api/families/[id]/children — 아이 추가 (법정대리인 동의 포함)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: familyId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { name: string; grade: string; interests: string[]; guardian_consent: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, grade, interests, guardian_consent } = body;
  if (!name?.trim() || !grade || !Array.isArray(interests) || interests.length === 0) {
    return NextResponse.json({ error: "name, grade, interests 필수" }, { status: 400 });
  }
  if (!guardian_consent) {
    return NextResponse.json({ error: "법정대리인 동의가 필요합니다" }, { status: 400 });
  }

  const svc = createServiceClient();

  // 부모 권한 확인
  const { data: member } = await svc
    .from("family_members")
    .select("role")
    .eq("family_id", familyId)
    .eq("user_id", user.id)
    .single();
  if (!member || !["owner_parent", "parent"].includes(member.role)) {
    return NextResponse.json({ error: "가족 부모만 아이를 추가할 수 있습니다" }, { status: 403 });
  }

  const { data: child, error } = await svc
    .from("child_profiles")
    .insert({ family_id: familyId, name: name.trim(), grade, interests })
    .select("id, name, grade, interests, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 법정대리인 동의 기록 — invite code에도 저장되므로 여기선 child_invite_codes 생성 시 기록
  return NextResponse.json({ child }, { status: 201 });
}
