import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/families/[id]/join-requests/[requestId]/reject
 *
 * 오너가 합류 신청을 거절.
 *
 * Response:
 *   200 { ok: true }
 *   403 오너 권한 없음
 *   404 신청 없음
 *   409 이미 처리된 신청
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> }
) {
  const { id: familyId, requestId } = await params;
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

  // ── 신청 조회 (member_request 방향만 오너가 거절 가능) ────────────
  const { data: request } = await svc
    .from("family_join_requests")
    .select("id, status, direction")
    .eq("id", requestId)
    .eq("family_id", familyId)
    .eq("direction", "member_request")
    .maybeSingle();

  if (!request) {
    return NextResponse.json({ error: "신청을 찾을 수 없습니다." }, { status: 404 });
  }
  if (request.status !== "pending") {
    return NextResponse.json(
      { error: `이미 ${request.status === "approved" ? "승인" : "거절"}된 신청입니다.` },
      { status: 409 }
    );
  }

  // ── 신청 거절 처리 ────────────────────────────────────────────────
  const { error: updateErr } = await svc
    .from("family_join_requests")
    .update({
      status: "rejected",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
