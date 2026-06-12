import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/families/[id]/sent-invites/[requestId]/cancel
 *
 * 오너가 자신이 보낸 owner_invite를 취소(철회).
 * pending 상태인 초대만 취소 가능 → status='cancelled'.
 *
 * Response:
 *   200 { ok: true }
 *   403 오너 권한 없음
 *   404 초대 없음
 *   409 이미 처리된 초대 (pending이 아님)
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

  // ── 초대 조회 (이 가족에서 오너가 보낸 owner_invite만) ─────────────
  const { data: invite } = await svc
    .from("family_join_requests")
    .select("id, status, requester_user_id")
    .eq("id", requestId)
    .eq("family_id", familyId)
    .eq("direction", "owner_invite")
    .maybeSingle();

  if (!invite) {
    return NextResponse.json({ error: "초대를 찾을 수 없습니다." }, { status: 404 });
  }

  // 이 가족의 오너가 보낸 초대인지 재확인
  if (invite.requester_user_id !== user.id) {
    return NextResponse.json({ error: "내가 보낸 초대가 아닙니다." }, { status: 403 });
  }

  if (invite.status !== "pending") {
    const label =
      invite.status === "approved" ? "수락됨" :
      invite.status === "rejected" ? "거절됨" : "이미 취소됨";
    return NextResponse.json(
      { error: `취소할 수 없는 초대입니다 (${label}).` },
      { status: 409 }
    );
  }

  // ── status → cancelled ────────────────────────────────────────────
  const { error: updateErr } = await svc
    .from("family_join_requests")
    .update({ status: "cancelled", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("id", requestId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
