import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// POST /api/families/[id]/members/[memberId]/reset-password
// 오너가 구성원의 비밀번호를 초기화 (must_change_password 다시 true)
// [memberId] = family_members.id
// Body: { new_password: string }
// Returns: { ok: true }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const { id: familyId, memberId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { new_password: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { new_password } = body;
  if (!new_password || new_password.length < 6) {
    return NextResponse.json({ error: "비밀번호는 6자 이상이어야 합니다" }, { status: 400 });
  }

  const svc = createServiceClient();

  // ── 호출자가 해당 가족 오너인지 확인 ──────────────────────────────
  const { data: ownerMember } = await svc
    .from("family_members")
    .select("role")
    .eq("family_id", familyId)
    .eq("user_id", user.id)
    .single();
  if (!ownerMember || ownerMember.role !== "owner_parent") {
    return NextResponse.json({ error: "가족 오너만 비밀번호를 초기화할 수 있습니다" }, { status: 403 });
  }

  // ── 대상 구성원 조회 (같은 가족 소속 확인) ────────────────────────
  const { data: targetMember } = await svc
    .from("family_members")
    .select("id, user_id, role")
    .eq("id", memberId)
    .eq("family_id", familyId)
    .single();
  if (!targetMember) {
    return NextResponse.json({ error: "구성원을 찾을 수 없습니다" }, { status: 404 });
  }
  // 오너 자신의 비밀번호는 이 API로 초기화 불가 (오너는 소셜 계정)
  if (targetMember.user_id === user.id) {
    return NextResponse.json({ error: "오너 계정은 이 API로 변경할 수 없습니다" }, { status: 400 });
  }

  // ── member_accounts 존재 여부 확인 (아이디 계정만 리셋 가능) ──────
  const { data: memberAccount } = await svc
    .from("member_accounts")
    .select("id")
    .eq("id", targetMember.user_id)
    .maybeSingle();
  if (!memberAccount) {
    return NextResponse.json(
      { error: "소셜 계정은 이 API로 비밀번호를 초기화할 수 없습니다" },
      { status: 400 }
    );
  }

  // ── Supabase Auth 비밀번호 변경 ────────────────────────────────────
  const { error: authError } = await svc.auth.admin.updateUserById(targetMember.user_id, {
    password: new_password,
  });
  if (authError) {
    return NextResponse.json({ error: `비밀번호 변경 실패: ${authError.message}` }, { status: 500 });
  }

  // ── must_change_password 다시 true로 세팅 ─────────────────────────
  await svc
    .from("member_accounts")
    .update({ must_change_password: true })
    .eq("id", targetMember.user_id);

  return NextResponse.json({ ok: true });
}
