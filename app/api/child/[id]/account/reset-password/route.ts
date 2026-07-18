import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import crypto from "crypto";

export const runtime = "nodejs";

// POST /api/child/[id]/account/reset-password
// 오너 부모가 자녀의 비밀번호를 초기화하는 API
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: childId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── body 파싱 ──────────────────────────────────────────────────────
  let body: { new_password?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const { new_password } = body;
  if (new_password !== undefined && new_password.length < 6) {
    return NextResponse.json({ error: "비밀번호는 6자 이상이어야 합니다" }, { status: 400 });
  }

  const svc = createServiceClient();

  // ── 3단계: child_profiles에서 id, family_id, member_id 조회 ─────────────────
  const { data: childProfile } = await svc
    .from("child_profiles")
    .select("id, family_id, member_id")
    .eq("id", childId)
    .maybeSingle();

  if (!childProfile) {
    return NextResponse.json({ error: "자녀 프로필을 찾을 수 없습니다" }, { status: 404 });
  }

  // ── 4단계: family_members에서 family_id + user_id=현재유저 + role='owner_parent' 검증 ────────────────
  const { data: ownerMember } = await svc
    .from("family_members")
    .select("role")
    .eq("family_id", childProfile.family_id)
    .eq("user_id", user.id)
    .eq("role", "owner_parent")
    .maybeSingle();

  if (!ownerMember) {
    return NextResponse.json(
      { error: "가족 오너만 자녀 비밀번호를 초기화할 수 있습니다" },
      { status: 403 }
    );
  }

  // ── 5단계: child_profiles.member_id로 family_members(자녀 구성원 행) 조회해 user_id 획득 및 username 조회 ──
  if (!childProfile.member_id) {
    return NextResponse.json({ error: "발급된 계정이 없습니다" }, { status: 404 });
  }

  const { data: familyMember } = await svc
    .from("family_members")
    .select("user_id")
    .eq("id", childProfile.member_id)
    .eq("family_id", childProfile.family_id)
    .eq("role", "child")
    .maybeSingle();

  if (!familyMember || !familyMember.user_id) {
    return NextResponse.json({ error: "발급된 계정이 없습니다" }, { status: 404 });
  }

  const { data: memberAccount } = await svc
    .from("member_accounts")
    .select("username")
    .eq("id", familyMember.user_id)
    .maybeSingle();

  if (!memberAccount) {
    return NextResponse.json({ error: "발급된 계정이 없습니다" }, { status: 404 });
  }

  const targetUserId = familyMember.user_id;

  // ── 6단계: 비밀번호 결정 (전달되지 않은 경우 아이가 입력하기 쉬운 10자리 임시 비밀번호 생성) ───────
  let finalPassword = new_password;
  if (!finalPassword) {
    // 가독성 좋은 대문자 + 숫자 조합 10자리 임시 비밀번호 생성 (헷갈리는 0, O, 1, I 등은 제외할 수도 있으나 간단히 안전한 문자셋 사용)
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // O, I, 0, 1을 배제하여 가독성을 높임
    let tempPw = "";
    for (let i = 0; i < 10; i++) {
      const randomIndex = crypto.randomInt(0, chars.length);
      tempPw += chars[randomIndex];
    }
    finalPassword = tempPw;
  }

  // ── 7단계: Supabase Auth 비밀번호 변경 ─────────────────────────────────────
  const { error: authError } = await svc.auth.admin.updateUserById(targetUserId, {
    password: finalPassword,
  });

  if (authError) {
    return NextResponse.json(
      { error: `비밀번호 변경 실패: ${authError.message}` },
      { status: 500 }
    );
  }

  // ── 8단계: member_accounts.must_change_password = true 업데이트 ───────────
  await svc
    .from("member_accounts")
    .update({ must_change_password: true })
    .eq("id", targetUserId);

  // ── 9단계: 감사로그(reset_password) INSERT (실패 시 무시) ───────────────────
  try {
    const { error: auditError } = await svc
      .from("account_management_audit_log")
      .insert({
        actor_user_id: user.id,
        actor_email: user.email || "",
        action: "reset_password",
        child_id: childId,
        family_id: childProfile.family_id,
      });
    if (auditError) {
      console.error("Failed to insert audit log:", auditError);
    }
  } catch (e) {
    console.error("Audit log exception:", e);
  }

  // ── 10단계: { username, password: 최종비밀번호 } 응답 ──────────────────────
  return NextResponse.json({
    username: memberAccount.username,
    password: finalPassword,
  });
}
