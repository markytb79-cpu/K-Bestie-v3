import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// POST /api/auth/join-child
// 아이가 로그인 후 초대 코드로 가족에 연결
// Body: { code: string }
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let code: string;
  try {
    ({ code } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!code?.trim()) return NextResponse.json({ error: "code 필수" }, { status: 400 });

  const svc = createServiceClient();

  const { data: inv, error } = await svc
    .from("child_invite_codes")
    .select("id, family_id, child_profile_id, expires_at, used_at")
    .eq("code", code.trim().toUpperCase())
    .single();

  if (error || !inv) return NextResponse.json({ error: "유효하지 않은 초대 코드" }, { status: 404 });
  if (inv.used_at) return NextResponse.json({ error: "이미 사용된 코드입니다" }, { status: 410 });
  if (new Date(inv.expires_at) < new Date()) {
    return NextResponse.json({ error: "만료된 코드입니다" }, { status: 410 });
  }

  // 이미 해당 가족 구성원인지 확인
  const { data: existing } = await svc
    .from("family_members")
    .select("id")
    .eq("family_id", inv.family_id)
    .eq("user_id", user.id)
    .single();
  if (existing) return NextResponse.json({ error: "이미 가족 구성원입니다" }, { status: 409 });

  // family_members에 child 역할로 추가
  const { data: newMember, error: memErr } = await svc
    .from("family_members")
    .insert({ family_id: inv.family_id, user_id: user.id, role: "child" })
    .select("id")
    .single();
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

  // child_profiles.member_id 연결
  await svc
    .from("child_profiles")
    .update({ member_id: newMember.id })
    .eq("id", inv.child_profile_id);

  // 코드 사용 처리
  await svc
    .from("child_invite_codes")
    .update({ used_at: new Date().toISOString(), used_by_user_id: user.id })
    .eq("id", inv.id);

  return NextResponse.json({
    ok: true,
    family_id: inv.family_id,
    child_profile_id: inv.child_profile_id,
  });
}
