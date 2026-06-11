import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// username → Supabase Auth 내부 이메일 (절대 사용자에게 노출 금지)
const FAKE_DOMAIN = "kbestie.local";
const toAuthEmail = (username: string) => `${username}@${FAKE_DOMAIN}`;

// 허용 형식: 영문·숫자·한글·밑줄·하이픈, 2~20자, 공백 불가
const USERNAME_REGEX = /^[a-zA-Z0-9가-힣_-]{2,20}$/;

// POST /api/families/[id]/members
// 오너가 가족 구성원(배우자=parent 또는 아이=child) 아이디+비번 계정을 직접 발급
// Body: { username, password, name, role, grade?, interests[], guardian_consent? }
// Returns: { member: { id, username, role, name, must_change_password: true }, child_profile? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: familyId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    username: string;
    password: string;
    name: string;
    role: string;
    grade?: string;
    interests?: string[];
    guardian_consent?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { username, password, name, role, grade, interests, guardian_consent } = body;

  // ── 입력 검증 ──────────────────────────────────────────────────────
  if (!username?.trim() || !password || !name?.trim() || !role) {
    return NextResponse.json({ error: "username, password, name, role 필수" }, { status: 400 });
  }
  if (!USERNAME_REGEX.test(username)) {
    return NextResponse.json(
      { error: "아이디는 영문·숫자·한글·_·- 2~20자만 사용할 수 있습니다" },
      { status: 400 }
    );
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "비밀번호는 6자 이상이어야 합니다" }, { status: 400 });
  }
  if (!["parent", "child"].includes(role)) {
    return NextResponse.json({ error: "role은 parent 또는 child만 허용됩니다" }, { status: 400 });
  }
  if (role === "child") {
    if (!grade || !Array.isArray(interests) || interests.length === 0) {
      return NextResponse.json({ error: "아이 등록 시 grade, interests 필수" }, { status: 400 });
    }
    if (!guardian_consent) {
      return NextResponse.json({ error: "법정대리인 동의가 필요합니다" }, { status: 400 });
    }
  }

  const svc = createServiceClient();

  // ── 오너 권한 확인 ──────────────────────────────────────────────────
  const { data: ownerMember } = await svc
    .from("family_members")
    .select("role")
    .eq("family_id", familyId)
    .eq("user_id", user.id)
    .single();
  if (!ownerMember || ownerMember.role !== "owner_parent") {
    return NextResponse.json({ error: "가족 오너만 구성원 계정을 발급할 수 있습니다" }, { status: 403 });
  }

  // ── username 전역 유일성 확인 ──────────────────────────────────────
  const { data: existingUsername } = await svc
    .from("member_accounts")
    .select("id")
    .eq("username", username.trim())
    .maybeSingle();
  if (existingUsername) {
    return NextResponse.json(
      { error: "이미 사용 중인 아이디입니다. 다른 아이디를 사용하세요" },
      { status: 409 }
    );
  }

  // ── parent 2명 제한 ────────────────────────────────────────────────
  if (role === "parent") {
    const { count: parentCount } = await svc
      .from("family_members")
      .select("*", { count: "exact", head: true })
      .eq("family_id", familyId)
      .in("role", ["owner_parent", "parent"]);
    if ((parentCount ?? 0) >= 2) {
      return NextResponse.json({ error: "보호자는 최대 2명까지만 등록할 수 있습니다" }, { status: 403 });
    }
  }

  // ── Supabase Auth 계정 생성 ─────────────────────────────────────────
  // 내부 이메일: username@kbestie.local (사용자에게 절대 노출 금지)
  const authEmail = toAuthEmail(username.trim());
  const { data: authData, error: authError } = await svc.auth.admin.createUser({
    email: authEmail,
    password,
    email_confirm: true, // 이메일 인증 불필요 (아이디 계정)
    user_metadata: {
      name: name.trim(),
      username: username.trim(),
      is_member_account: true,
    },
  });
  if (authError) {
    return NextResponse.json({ error: `계정 생성 실패: ${authError.message}` }, { status: 500 });
  }
  const newUserId = authData.user.id;

  // ── family_members 등록 ─────────────────────────────────────────────
  const { data: familyMember, error: fmError } = await svc
    .from("family_members")
    .insert({ family_id: familyId, user_id: newUserId, role })
    .select("id")
    .single();
  if (fmError) {
    await svc.auth.admin.deleteUser(newUserId);
    return NextResponse.json({ error: `가족 등록 실패: ${fmError.message}` }, { status: 500 });
  }

  // ── member_accounts 등록 ────────────────────────────────────────────
  const { error: accError } = await svc.from("member_accounts").insert({
    id: newUserId,
    username: username.trim(),
    email: null,             // 향후 실제 이메일 인증용 (베타는 NULL)
    display_name: name.trim(),
    family_id: familyId,
    role,
    created_by: user.id,
    must_change_password: true,
  });
  if (accError) {
    await svc.from("family_members").delete().eq("id", familyMember.id);
    await svc.auth.admin.deleteUser(newUserId);
    return NextResponse.json({ error: `계정 정보 저장 실패: ${accError.message}` }, { status: 500 });
  }

  // ── 아이인 경우 child_profiles 생성 ────────────────────────────────
  let childProfile: { id: string; name: string; grade: string; interests: string[] } | null = null;
  if (role === "child") {
    const { data: cp, error: cpError } = await svc
      .from("child_profiles")
      .insert({
        family_id: familyId,
        member_id: familyMember.id,
        name: name.trim(),
        grade,
        interests,
        email: null, // 아이디 계정은 이메일 불필요
      })
      .select("id, name, grade, interests")
      .single();
    if (cpError) {
      await svc.from("member_accounts").delete().eq("id", newUserId);
      await svc.from("family_members").delete().eq("id", familyMember.id);
      await svc.auth.admin.deleteUser(newUserId);
      return NextResponse.json({ error: `아이 프로필 생성 실패: ${cpError.message}` }, { status: 500 });
    }
    childProfile = cp;
  }

  return NextResponse.json(
    {
      member: {
        id: newUserId,
        username: username.trim(),
        role,
        name: name.trim(),
        must_change_password: true,
      },
      child_profile: childProfile,
    },
    { status: 201 }
  );
}
