import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// POST /api/families/[id]/invite-parent
// Body: { email: string }
// Returns: { token, invite_url, expires_at }
// TODO: Supabase SMTP 연동 시 여기서 이메일 발송 (현재 링크만 반환)
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

  // 이미 유효한 초대가 있으면 재사용
  const { data: existing } = await svc
    .from("parent_invitations")
    .select("token, expires_at")
    .eq("family_id", familyId)
    .eq("invited_email", email.trim().toLowerCase())
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (existing) {
    const inviteUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(".supabase.co", "")}/invite/accept?token=${existing.token}`;
    return NextResponse.json({ token: existing.token, invite_url: inviteUrl, expires_at: existing.expires_at });
  }

  const { data: inv, error } = await svc
    .from("parent_invitations")
    .insert({
      family_id: familyId,
      invited_email: email.trim().toLowerCase(),
      invited_by: user.id,
    })
    .select("token, expires_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const inviteUrl = `${appUrl}/invite/accept?token=${inv.token}`;

  // TODO: Supabase SMTP or Resend 연동 — 아래 지점에 이메일 발송 추가
  // await sendInviteEmail({ to: email, inviteUrl, familyName })

  return NextResponse.json({ token: inv.token, invite_url: inviteUrl, expires_at: inv.expires_at }, { status: 201 });
}
