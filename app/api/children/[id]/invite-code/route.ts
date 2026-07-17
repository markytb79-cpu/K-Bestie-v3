import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

// GET /api/children/[id]/invite-code — 현재 유효한 코드 조회
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: childId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { allowed } = await requireChildAccess(supabase, user.id, childId);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const svc = createServiceClient();

  const { data, error } = await svc
    .from("child_invite_codes")
    .select("code, expires_at, used_at, guardian_consent, guardian_consent_at")
    .eq("child_profile_id", childId)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error) return NextResponse.json({ code: null });
  return NextResponse.json(data);
}


// POST /api/children/[id]/invite-code — 아이 초대 코드 발급
// Body: { guardian_consent: true }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: childId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let guardian_consent: boolean;
  try {
    ({ guardian_consent } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!guardian_consent) {
    return NextResponse.json({ error: "법정대리인 동의가 필요합니다" }, { status: 400 });
  }

  const svc = createServiceClient();

  // 아이가 이 부모의 가족에 속하는지 확인
  const { data: child } = await svc
    .from("child_profiles")
    .select("family_id")
    .eq("id", childId)
    .single();
  if (!child) return NextResponse.json({ error: "아이를 찾을 수 없습니다" }, { status: 404 });

  const { data: member } = await svc
    .from("family_members")
    .select("role")
    .eq("family_id", child.family_id)
    .eq("user_id", user.id)
    .single();
  if (!member || !["owner_parent", "parent"].includes(member.role)) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }

  const { data, error } = await svc
    .from("child_invite_codes")
    .insert({
      family_id: child.family_id,
      child_profile_id: childId,
      created_by: user.id,
      guardian_consent: true,
      guardian_consent_at: new Date().toISOString(),
    })
    .select("code, expires_at, guardian_consent_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
