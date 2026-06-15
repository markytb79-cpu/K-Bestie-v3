import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const { id: familyId, memberId } = await params;

  // 1. 로그인 유저 확인 (anon client)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();

  // 2. 가족 오너 권한 검증 (families.created_by === user.id)
  const { data: family, error: famError } = await svc
    .from("families")
    .select("created_by")
    .eq("id", familyId)
    .maybeSingle();

  if (famError || !family) {
    return NextResponse.json({ error: "가족을 찾을 수 없습니다." }, { status: 404 });
  }

  if (family.created_by !== user.id) {
    return NextResponse.json({ error: "오너만 가족 구성원을 제거할 수 있습니다." }, { status: 403 });
  }

  // 3. 제거할 대상 구성원 정보 조회
  const { data: member, error: memError } = await svc
    .from("family_members")
    .select("id, role, user_id")
    .eq("id", memberId)
    .eq("family_id", familyId)
    .maybeSingle();

  if (memError || !member) {
    return NextResponse.json({ error: "가족 구성원을 찾을 수 없습니다." }, { status: 404 });
  }

  // (1) owner_parent (오너 자신) 제거 불가 -> 403
  if (member.role === "owner_parent") {
    return NextResponse.json({ error: "가족 오너는 자기 자신을 제거할 수 없습니다." }, { status: 403 });
  }

  // (2) role이 parent인 보호자만 가능. child는 제외
  if (member.role !== "parent") {
    return NextResponse.json({ error: "제거할 수 없는 역할의 구성원입니다." }, { status: 403 });
  }

  // 4. 구성원 삭제
  const { error: delError } = await svc
    .from("family_members")
    .delete()
    .eq("id", memberId);

  if (delError) {
    return NextResponse.json({ error: delError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
