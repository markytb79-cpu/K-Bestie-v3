import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/families/[id]/sent-invites?status=pending
 *
 * 오너가 자기 가족에서 보낸 owner_invite 목록 조회.
 * status 쿼리: pending(기본) | approved | rejected | cancelled | all
 *
 * Response: { invites: [{ id, target_email, target_user_id, status, created_at, reviewed_at }] }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: familyId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = createServiceClient();

  // ── 오너 권한 확인 ──────────────────────────────────────────────────
  const { data: family } = await svc
    .from("families")
    .select("id")
    .eq("id", familyId)
    .eq("created_by", user.id)
    .maybeSingle();

  if (!family) {
    return NextResponse.json({ error: "가족을 찾을 수 없거나 오너 권한이 없습니다." }, { status: 403 });
  }

  const statusParam = req.nextUrl.searchParams.get("status") ?? "pending";
  const allowedStatuses = ["pending", "approved", "rejected", "cancelled", "all"];
  if (!allowedStatuses.includes(statusParam)) {
    return NextResponse.json(
      { error: "status는 pending|approved|rejected|cancelled|all 중 하나여야 합니다." },
      { status: 400 }
    );
  }

  let query = svc
    .from("family_join_requests")
    .select("id, requester_email, target_user_id, status, created_at, reviewed_at")
    .eq("family_id", familyId)
    .eq("direction", "owner_invite")
    .order("created_at", { ascending: false });

  if (statusParam !== "all") {
    query = query.eq("status", statusParam);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const invites = (data ?? []).map((row) => ({
    id: row.id,
    target_email: row.requester_email,   // 오너가 입력한 초대 대상 이메일
    target_user_id: row.target_user_id,
    status: row.status,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at,
  }));

  return NextResponse.json({ invites });
}
