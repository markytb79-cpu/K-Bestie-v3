import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/families/[id] — 가족 상세 (구성원 + 아이)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── 인증: anon client로 로그인 사용자 확인 ───────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = createServiceClient();

  // ── 권한 검증: 오너 또는 구성원인지 명시적으로 확인 ──────────────
  const { data: fam } = await svc
    .from("families")
    .select("id, created_by")
    .eq("id", id)
    .maybeSingle();

  if (!fam) return NextResponse.json({ error: "가족을 찾을 수 없습니다." }, { status: 404 });

  const isOwner = fam.created_by === user.id;
  if (!isOwner) {
    const { data: memberRow } = await svc
      .from("family_members")
      .select("id")
      .eq("family_id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!memberRow) {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }
  }

  // ── 데이터 조회: service client로 RLS 없이 전체 조회 ─────────────
  const { data: family, error } = await svc
    .from("families")
    .select(`
      id, name, created_by, created_at,
      family_members(id, user_id, role, joined_at),
      child_profiles(id, name, grade, interests, created_at, tier)
    `)
    .eq("id", id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── 소셜 보호자 이름 & 이메일: parents 조인 (member_accounts 없는 경우 대비) ──
  const parentUserIds = ((family.family_members ?? []) as Array<{ user_id: string; role: string }>)
    .filter((m) => m.role === "owner_parent" || m.role === "parent")
    .map((m) => m.user_id)
    .filter(Boolean);

  let parentsNameMap: Record<string, string> = {};
  let parentsEmailMap: Record<string, string> = {};
  if (parentUserIds.length > 0) {
    const { data: parentRows } = await svc
      .from("parents")
      .select("id, name, email")
      .in("id", parentUserIds);
    parentsNameMap = Object.fromEntries(
      ((parentRows ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name])
    );
    parentsEmailMap = Object.fromEntries(
      ((parentRows ?? []) as Array<{ id: string; email: string }>).map((p) => [p.id, p.email])
    );
  }

  const membersWithParentName = ((family.family_members ?? []) as Array<Record<string, unknown>>).map((m) => ({
    ...m,
    parent_name: (m.role === "owner_parent" || m.role === "parent")
      ? (parentsNameMap[m.user_id as string] ?? null)
      : null,
    parent_email: (m.role === "owner_parent" || m.role === "parent")
      ? (parentsEmailMap[m.user_id as string] ?? null)
      : null,
  }));

  return NextResponse.json({ family: { ...family, family_members: membersWithParentName } });
}

// PATCH /api/families/[id] — 가족 이름 수정 (오너만)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let name: string;
  try {
    ({ name } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!name?.trim()) return NextResponse.json({ error: "name 필수" }, { status: 400 });

  const { data, error } = await createServiceClient()
    .from("families")
    .update({ name: name.trim() })
    .eq("id", id)
    .eq("created_by", user.id)
    .select("id, name")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ family: data });
}
