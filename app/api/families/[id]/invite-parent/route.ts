import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
// [DEACTIVATED] import { sendEmail } from "@/lib/mail";
// 베타 전환: 초대 메일 발송 비활성. invite_url을 프론트에서 직접 공유(카카오톡 등).

export const runtime = "nodejs";

// POST /api/families/[id]/invite-parent
// Body: { email: string }
// Returns: { token, invite_url, expires_at }
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
  if (!email?.trim()) return NextResponse.json({ error: "email 필수" }, { status: 400 });

  const invitedEmail = email.trim().toLowerCase();
  const svc = createServiceClient();

  // 초대자가 해당 가족 부모인지 확인
  const { data: member } = await svc
    .from("family_members")
    .select("role")
    .eq("family_id", familyId)
    .eq("user_id", user.id)
    .single();
  if (!member || !["owner_parent", "parent"].includes(member.role)) {
    return NextResponse.json({ error: "가족 부모만 초대할 수 있습니다" }, { status: 403 });
  }

  // 보호자 최대 2명 제한 (현재 부모 수 + 유효한 미수락 초대 수)
  const [{ count: parentCount }, { count: pendingCount }] = await Promise.all([
    svc
      .from("family_members")
      .select("*", { count: "exact", head: true })
      .eq("family_id", familyId)
      .in("role", ["owner_parent", "parent"]),
    svc
      .from("parent_invitations")
      .select("*", { count: "exact", head: true })
      .eq("family_id", familyId)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString()),
  ]);
  if ((parentCount ?? 0) + (pendingCount ?? 0) >= 2) {
    return NextResponse.json({ error: "보호자는 최대 2명까지만 등록할 수 있습니다" }, { status: 403 });
  }

  // 가족 이름 조회
  const { data: family } = await svc
    .from("families")
    .select("name")
    .eq("id", familyId)
    .single();
  const familyName = family?.name || "가족";

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // 이미 유효한 초대가 있으면 재사용
  const { data: existing } = await svc
    .from("parent_invitations")
    .select("token, expires_at")
    .eq("family_id", familyId)
    .eq("invited_email", invitedEmail)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (existing) {
    const inviteUrl = `${appUrl}/invite/accept?token=${existing.token}`;
    // [DEACTIVATED] 이메일 발송 — 프론트에서 invite_url을 카카오톡/문자로 직접 공유
    return NextResponse.json({ token: existing.token, invite_url: inviteUrl, expires_at: existing.expires_at });
  }

  const { data: inv, error } = await svc
    .from("parent_invitations")
    .insert({
      family_id: familyId,
      invited_email: invitedEmail,
      invited_by: user.id,
    })
    .select("token, expires_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const inviteUrl = `${appUrl}/invite/accept?token=${inv.token}`;
  // [DEACTIVATED] 이메일 발송 — 프론트에서 invite_url을 카카오톡/문자로 직접 공유

  return NextResponse.json({ token: inv.token, invite_url: inviteUrl, expires_at: inv.expires_at }, { status: 201 });
}
