import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/invitations/[token] — 초대 정보 조회 (수락 전 미리보기)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const svc = createServiceClient();

  const { data, error } = await svc
    .from("parent_invitations")
    .select("id, family_id, invited_email, role, expires_at, accepted_at, families(name)")
    .eq("token", token)
    .single();

  if (error || !data) return NextResponse.json({ error: "유효하지 않은 초대 링크" }, { status: 404 });
  if (data.accepted_at) return NextResponse.json({ error: "이미 수락된 초대입니다" }, { status: 410 });
  if (new Date(data.expires_at) < new Date()) {
    return NextResponse.json({ error: "만료된 초대 링크입니다" }, { status: 410 });
  }

  return NextResponse.json({
    family_id: data.family_id,
    family_name: (data.families as unknown as { name: string } | null)?.name,
    invited_email: data.invited_email,
    role: data.role,
    expires_at: data.expires_at,
  });
}

// POST /api/invitations/[token] — 초대 수락 (로그인 후 호출)
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = createServiceClient();

  const { data: inv, error } = await svc
    .from("parent_invitations")
    .select("id, family_id, invited_email, role, expires_at, accepted_at")
    .eq("token", token)
    .single();

  if (error || !inv) return NextResponse.json({ error: "유효하지 않은 초대 링크" }, { status: 404 });
  if (inv.accepted_at) return NextResponse.json({ error: "이미 수락된 초대입니다" }, { status: 410 });
  if (new Date(inv.expires_at) < new Date()) {
    return NextResponse.json({ error: "만료된 초대 링크입니다" }, { status: 410 });
  }

  // 이미 해당 가족 구성원인지 확인
  const { data: existing } = await svc
    .from("family_members")
    .select("id")
    .eq("family_id", inv.family_id)
    .eq("user_id", user.id)
    .single();
  if (existing) return NextResponse.json({ error: "이미 가족 구성원입니다" }, { status: 409 });

  // 보호자 최대 2명 제한 확인
  const { count: parentCount } = await svc
    .from("family_members")
    .select("*", { count: "exact", head: true })
    .eq("family_id", inv.family_id)
    .in("role", ["owner_parent", "parent"]);
  if ((parentCount ?? 0) >= 2) {
    return NextResponse.json({ error: "이 가족에는 이미 보호자가 2명 등록되어 있습니다" }, { status: 403 });
  }

  // 가족 구성원 추가
  const { error: memErr } = await svc
    .from("family_members")
    .insert({ family_id: inv.family_id, user_id: user.id, role: inv.role });
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

  // 초대 수락 처리
  await svc
    .from("parent_invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", inv.id);

  return NextResponse.json({ ok: true, family_id: inv.family_id });
}
