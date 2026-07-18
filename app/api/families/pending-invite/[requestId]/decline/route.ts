import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { requestId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();

  // family_join_requests에서 id=requestId인 행 조회
  const { data: request, error: reqError } = await svc
    .from("family_join_requests")
    .select("family_id, requester_user_id, requester_email, target_user_id, status, direction")
    .eq("id", requestId)
    .maybeSingle();

  if (reqError) {
    return NextResponse.json({ error: reqError.message }, { status: 500 });
  }
  if (!request) {
    return NextResponse.json({ error: "초대 요청을 찾을 수 없습니다." }, { status: 404 });
  }

  const userEmail = user.email?.trim().toLowerCase();

  // 검증 (accept와 동일한 권한 체크)
  if (request.direction !== "owner_invite") {
    return NextResponse.json({ error: "잘못된 초대 방향입니다." }, { status: 400 });
  }

  if (request.target_user_id) {
    if (request.target_user_id !== user.id) {
      return NextResponse.json({ error: "본인의 초대가 아닙니다." }, { status: 403 });
    }
  } else {
    if (!userEmail || request.requester_email?.trim().toLowerCase() !== userEmail) {
      return NextResponse.json({ error: "본인의 초대가 아닙니다." }, { status: 403 });
    }
  }

  // status 상태 확인 및 거절 처리
  if (request.status === "rejected") {
    return NextResponse.json({ ok: true });
  } else if (request.status !== "pending") {
    return NextResponse.json({ error: "이미 처리된 초대입니다." }, { status: 409 });
  }

  // status가 'pending' 이면 UPDATE
  const { error: updateError } = await svc
    .from("family_join_requests")
    .update({
      status: "rejected",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
