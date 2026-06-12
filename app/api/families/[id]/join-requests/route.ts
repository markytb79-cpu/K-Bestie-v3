import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/families/[id]/join-requests?status=pending
 *
 * 오너가 자기 가족의 합류 신청 목록 조회.
 * status 쿼리 파라미터: pending(기본) | approved | rejected | all
 *
 * Response: { requests: [...] }
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

  // 오너 권한 확인
  const { data: family } = await svc
    .from("families")
    .select("id, name")
    .eq("id", familyId)
    .eq("created_by", user.id)
    .maybeSingle();

  if (!family) {
    return NextResponse.json({ error: "가족을 찾을 수 없거나 오너 권한이 없습니다." }, { status: 403 });
  }

  const statusParam = req.nextUrl.searchParams.get("status") ?? "pending";
  const allowedStatuses = ["pending", "approved", "rejected", "all"];
  if (!allowedStatuses.includes(statusParam)) {
    return NextResponse.json({ error: "status는 pending|approved|rejected|all 중 하나여야 합니다." }, { status: 400 });
  }

  // 오너 inbox = 배우자가 신청한 member_request만 표시
  let query = svc
    .from("family_join_requests")
    .select("id, requester_user_id, requester_email, status, created_at, reviewed_at")
    .eq("family_id", familyId)
    .eq("direction", "member_request")
    .order("created_at", { ascending: false });

  if (statusParam !== "all") {
    query = query.eq("status", statusParam);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ requests: data ?? [] });
}
