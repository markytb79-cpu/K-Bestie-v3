import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const service = createServiceClient();
  
  // parents 테이블에서 RESTORE_REQUESTED인 사용자 조회
  const { data: parents, error } = await service
    .from("parents")
    .select("id, email, name, withdrawn_at, purge_scheduled_at, withdrawal_reason, restore_requested_at")
    .eq("account_status", "RESTORE_REQUESTED")
    .order("restore_requested_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 각 사용자의 family_members 정보 조인 (단독오너 범위 확인용)
  // service_role이므로 모두 조회 가능. 삭제된 가족(deleted_at IS NOT NULL)도 볼 수 있도록 조건 설정
  const { data: memberships, error: memError } = await service
    .from("family_members")
    .select(`
      user_id,
      role,
      family_id,
      deleted_at,
      families!inner (
        id,
        name,
        deleted_at,
        purge_batch_id
      )
    `)
    .in("user_id", parents.map(p => p.id));

  if (memError) {
    return NextResponse.json({ error: memError.message }, { status: 500 });
  }

  const result = parents.map(p => {
    const mems = memberships.filter(m => m.user_id === p.id);
    return {
      ...p,
      memberships: mems
    };
  });

  return NextResponse.json(result);
}
