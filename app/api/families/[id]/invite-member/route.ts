import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/families/[id]/invite-member
 * Body: { email: string }
 *
 * 오너가 이미 가입된 배우자를 이메일로 초대 (owner_invite 방향).
 * 배우자가 앱에서 직접 수락/거절 — 메일 발송 없음.
 *
 * Response:
 *   201 { invite: { id, family_id, target_user_id, status } }
 *   400 email 누락
 *   403 오너 권한 없음 | 보호자 정원 초과
 *   404 가입된 사용자 없음
 *   409 이미 pending 초대 존재 | 대상이 이미 구성원
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: familyId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let email: string;
  try {
    ({ email } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!email?.trim()) {
    return NextResponse.json({ error: "email 필수" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const svc = createServiceClient();

  // ── 오너 권한 확인 ──────────────────────────────────────────────────
  const { data: ownerMember } = await svc
    .from("family_members")
    .select("role")
    .eq("family_id", familyId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!ownerMember || ownerMember.role !== "owner_parent") {
    return NextResponse.json({ error: "가족 오너만 초대할 수 있습니다." }, { status: 403 });
  }

  // ── 초대 대상 사용자 조회 (parents 테이블 — 소셜 로그인 계정만) ──
  const { data: targetParent } = await svc
    .from("parents")
    .select("id, email")
    .eq("email", normalizedEmail)
    .not("email", "ilike", "%@kbestie.local")
    .maybeSingle();

  if (!targetParent) {
    return NextResponse.json(
      { error: "해당 이메일로 가입된 사용자가 없습니다. 상대방이 먼저 회원가입해야 합니다." },
      { status: 404 }
    );
  }

  // 자기 자신 초대 방지
  if (targetParent.id === user.id) {
    return NextResponse.json({ error: "자기 자신을 초대할 수 없습니다." }, { status: 400 });
  }

  // ── 대상이 이미 가족 구성원인지 확인 ─────────────────────────────
  const { data: alreadyMember } = await svc
    .from("family_members")
    .select("id")
    .eq("family_id", familyId)
    .eq("user_id", targetParent.id)
    .maybeSingle();

  if (alreadyMember) {
    return NextResponse.json({ error: "이미 가족 구성원입니다." }, { status: 409 });
  }

  // ── 보호자 정원 확인 ───────────────────────────────────────────────
  const { count: parentCount } = await svc
    .from("family_members")
    .select("*", { count: "exact", head: true })
    .eq("family_id", familyId)
    .in("role", ["owner_parent", "parent"]);

  if ((parentCount ?? 0) >= 2) {
    return NextResponse.json(
      { error: "보호자가 이미 2명입니다. 더 이상 초대할 수 없습니다." },
      { status: 403 }
    );
  }

  // ── 중복 pending 초대 방지 ─────────────────────────────────────────
  const { data: existingInvite } = await svc
    .from("family_join_requests")
    .select("id, status")
    .eq("family_id", familyId)
    .eq("target_user_id", targetParent.id)
    .eq("direction", "owner_invite")
    .eq("status", "pending")
    .maybeSingle();

  if (existingInvite) {
    return NextResponse.json(
      { error: "이미 대기 중인 초대가 있습니다. 상대방의 응답을 기다려주세요." },
      { status: 409 }
    );
  }

  // ── 초대 레코드 생성 ──────────────────────────────────────────────
  const { data: invite, error: insertErr } = await svc
    .from("family_join_requests")
    .insert({
      family_id: familyId,
      requester_user_id: user.id,
      requester_email: normalizedEmail,   // 오너가 입력한 초대 대상 이메일
      target_user_id: targetParent.id,
      direction: "owner_invite",
      status: "pending",
    })
    .select("id, family_id, target_user_id, status, created_at")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json(
    { invite: { id: invite.id, family_id: invite.family_id, target_user_id: invite.target_user_id, status: invite.status, created_at: invite.created_at } },
    { status: 201 }
  );
}
