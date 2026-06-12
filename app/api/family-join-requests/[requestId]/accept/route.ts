import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/family-join-requests/[requestId]/accept
 *
 * 초대받은 배우자가 owner_invite를 수락.
 * 수락 시 family_members에 role=parent로 합류.
 * 자동 합류 없음 — 반드시 이 API를 명시적으로 호출해야 합류됨.
 *
 * Response:
 *   200 { ok: true, family_id }
 *   403 내 초대가 아님 | 보호자 정원 초과
 *   404 초대 없음
 *   409 이미 처리된 초대 | 이미 구성원
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
    .select("id, family_id, target_user_id, status, direction")
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

  // ── 이미 구성원인지 확인 ──────────────────────────────────────────
  const { data: alreadyMember } = await svc
    .from("family_members")
    .select("id")
    .eq("family_id", invite.family_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (alreadyMember) {
    await svc
      .from("family_join_requests")
      .update({ status: "approved", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
      .eq("id", requestId);
    return NextResponse.json({ error: "이미 가족 구성원입니다." }, { status: 409 });
  }

  // ── 보호자 정원 확인 (수락 시점 재확인 — 경쟁 조건 방어) ─────────
  const { count: parentCount } = await svc
    .from("family_members")
    .select("*", { count: "exact", head: true })
    .eq("family_id", invite.family_id)
    .in("role", ["owner_parent", "parent"]);

  if ((parentCount ?? 0) >= 2) {
    return NextResponse.json(
      { error: "보호자가 이미 2명입니다. 합류할 수 없습니다." },
      { status: 403 }
    );
  }

  // ── family_members 합류 ────────────────────────────────────────────
  const { error: memErr } = await svc
    .from("family_members")
    .insert({ family_id: invite.family_id, user_id: user.id, role: "parent" });

  if (memErr) {
    return NextResponse.json({ error: `가족 합류 실패: ${memErr.message}` }, { status: 500 });
  }

  // ── 초대 상태 업데이트 ─────────────────────────────────────────────
  await svc
    .from("family_join_requests")
    .update({ status: "approved", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq("id", requestId);

  return NextResponse.json({ ok: true, family_id: invite.family_id });
}
