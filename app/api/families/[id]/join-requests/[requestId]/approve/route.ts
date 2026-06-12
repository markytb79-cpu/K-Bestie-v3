import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/families/[id]/join-requests/[requestId]/approve
 *
 * 오너가 합류 신청을 승인.
 * 승인 시 family_members에 role=parent로 삽입.
 * 보호자 2명 초과 시 승인 거부 (경쟁 조건 방어).
 *
 * Response:
 *   200 { ok: true, family_id, member_user_id }
 *   403 오너 권한 없음 | 보호자 정원 초과
 *   404 신청 없음
 *   409 이미 처리된 신청 | 신청자가 이미 구성원
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

  // ── 신청 조회 ───────────────────────────────────────────────────────
  const { data: request } = await svc
    .from("family_join_requests")
    .select("id, family_id, requester_user_id, status")
    .eq("id", requestId)
    .eq("family_id", familyId)
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

  // ── 신청자가 이미 가족 구성원인지 확인 ─────────────────────────────
  const { data: alreadyMember } = await svc
    .from("family_members")
    .select("id")
    .eq("family_id", familyId)
    .eq("user_id", request.requester_user_id)
    .maybeSingle();

  if (alreadyMember) {
    // 신청 정리 후 409
    await svc
      .from("family_join_requests")
      .update({ status: "approved", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
      .eq("id", requestId);
    return NextResponse.json({ error: "신청자가 이미 가족 구성원입니다." }, { status: 409 });
  }

  // ── 보호자 정원 확인 (경쟁 조건 방어 — 승인 시점 재확인) ─────────
  const { count: parentCount } = await svc
    .from("family_members")
    .select("*", { count: "exact", head: true })
    .eq("family_id", familyId)
    .in("role", ["owner_parent", "parent"]);

  if ((parentCount ?? 0) >= 2) {
    return NextResponse.json(
      { error: "보호자가 이미 2명입니다. 더 이상 승인할 수 없습니다." },
      { status: 403 }
    );
  }

  // ── family_members 합류 ────────────────────────────────────────────
  const { error: memErr } = await svc
    .from("family_members")
    .insert({
      family_id: familyId,
      user_id: request.requester_user_id,
      role: "parent",
    });

  if (memErr) {
    return NextResponse.json({ error: `가족 합류 실패: ${memErr.message}` }, { status: 500 });
  }

  // ── 신청 상태 업데이트 ────────────────────────────────────────────
  await svc
    .from("family_join_requests")
    .update({
      status: "approved",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  return NextResponse.json({
    ok: true,
    family_id: familyId,
    member_user_id: request.requester_user_id,
  });
}
