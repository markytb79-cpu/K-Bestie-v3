import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/family-join-requests/[requestId]/decline
 *
 * 초대받은 배우자가 owner_invite를 거절.
 *
 * Response:
 *   200 { ok: true }
 *   403 내 초대가 아님
 *   404 초대 없음
 *   409 이미 처리된 초대
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { requestId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = createServiceClient();

  // ── 초대 조회 (내 앞으로 온 owner_invite만) ────────────────────
  const { data: invite } = await svc
    .from("family_join_requests")
    .select("id, target_user_id, status, direction")
    .eq("id", requestId)
    .eq("direction", "owner_invite")
    .maybeSingle();

  if (!invite) {
    return NextResponse.json({ error: "초대를 찾을 수 없습니다." }, { status: 404 });
  }
  if (invite.target_user_id !== user.id) {
    return NextResponse.json({ error: "내 앞으로 온 초대가 아닙니다." }, { status: 403 });
  }
  if (invite.status !== "pending") {
    return NextResponse.json(
      { error: `이미 ${invite.status === "approved" ? "수락" : "거절"}된 초대입니다.` },
      { status: 409 }
    );
  }

  const { error: updateErr } = await svc
    .from("family_join_requests")
    .update({ status: "rejected", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("id", requestId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
