import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

// GET /api/admin/children — 관리자 대시보드 아이 선택 드롭다운용 전체 가족 아이 목록.
// middleware.ts가 이미 /api/admin/*을 보호하지만, 라우트 자체도 401/403을 재검증한다(이중 방어).
export async function GET(_req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const service = createServiceClient();
  const { data: children, error } = await service
    .from("child_profiles")
    .select("id, name, grade, family_id")
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ children: children ?? [] });
}
