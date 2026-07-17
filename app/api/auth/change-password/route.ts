import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/auth/change-password
// 현재 로그인 유저의 must_change_password 상태 + username 반환
// 첫 로그인 직후 프론트에서 호출하여 비밀번호 변경 안내 여부 결정
// A안: service_role 없이 인증된 세션 클라이언트로 자기 행(id = auth.uid()) 조회
// member_accounts_select RLS 정책이 이미 id = auth.uid() 를 허용하므로 service-role 불필요
export async function GET(_req: NextRequest) {
  // 인증된 세션 클라이언트 사용 — SUPABASE_SERVICE_ROLE_KEY 불필요
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // member_accounts 자기 행 조회 (RLS: id = auth.uid() 허용)
  const { data: account, error: dbError } = await supabase
    .from("member_accounts")
    .select("username, must_change_password, role, family_id")
    .eq("id", user.id)
    .maybeSingle();

  if (dbError) {
    console.error("[change-password GET] member_accounts query error:", dbError.message);
    return NextResponse.json({ error: "서버 오류가 발생했습니다" }, { status: 500 });
  }

  if (!account) {
    // 소셜 계정(오너) — member_accounts 행 없음, must_change_password 해당 없음
    return NextResponse.json({ is_member_account: false, must_change_password: false }, { status: 200 });
  }

  return NextResponse.json({
    is_member_account: true,
    must_change_password: account.must_change_password,
    username: account.username,
    role: account.role,
    family_id: account.family_id,
  }, { status: 200 });
}

// POST /api/auth/change-password
// 구성원이 자신의 비밀번호를 변경하고 must_change_password 플래그를 해제
// Body: { new_password?: string, skip?: boolean }
//   new_password: 새 비밀번호 (6자 이상) — skip=false일 때 필수
//   skip: true이면 비밀번호 유지, 플래그만 해제 (나중에 변경 선택)
// Returns: { ok: true }
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { new_password?: string; skip?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { new_password, skip } = body;

  // ── member_accounts 계정인지 확인 (supabase 클라이언트 사용) ─────
  const { data: account, error: checkError } = await supabase
    .from("member_accounts")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (checkError) {
    return NextResponse.json({ error: checkError.message }, { status: 500 });
  }

  if (!account) {
    return NextResponse.json(
      { error: "소셜 계정은 이 API를 사용할 수 없습니다" },
      { status: 400 }
    );
  }

  // ── 비밀번호 변경 (skip이 아닌 경우) (일반 auth.updateUser API 사용) ──────
  if (!skip) {
    if (!new_password || new_password.length < 6) {
      return NextResponse.json({ error: "비밀번호는 6자 이상이어야 합니다" }, { status: 400 });
    }
    const { error: authError } = await supabase.auth.updateUser({
      password: new_password,
    });
    if (authError) {
      return NextResponse.json({ error: `비밀번호 변경 실패: ${authError.message}` }, { status: 500 });
    }
  }

  // ── must_change_password 플래그 해제 (supabase 클라이언트 사용) ───
  const { error: updateError } = await supabase
    .from("member_accounts")
    .update({ must_change_password: false })
    .eq("id", user.id);

  if (updateError) {
    return NextResponse.json({ error: `상태 업데이트 실패: ${updateError.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
