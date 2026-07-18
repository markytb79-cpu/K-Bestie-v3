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

  // 2. family_join_requests에서 id=requestId인 행 조회
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

  // 3. 검증
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

  // RPC 호출로 원자적 수락 처리 및 정원 재검증 진행
  let rpcResponse = await svc.rpc("accept_family_invite", {
    p_request_id: requestId,
    p_user_id: user.id,
    p_user_email: userEmail ?? null,
  });

  // 데드락(40P01) 또는 직렬화 장애(40001) 발생 시 1회 자동 재시도
  if (rpcResponse.error && (rpcResponse.error.code === "40P01" || rpcResponse.error.code === "40001")) {
    console.warn(`[accept_invite] Deadlock or serialization error (${rpcResponse.error.code}) detected. Retrying accept_family_invite once...`);
    rpcResponse = await svc.rpc("accept_family_invite", {
      p_request_id: requestId,
      p_user_id: user.id,
      p_user_email: userEmail ?? null,
    });
  }

  const { data: rpcResult, error: rpcError } = rpcResponse;

  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  const result = rpcResult?.[0] as
    | { success: boolean; reason: string; previous_family_id: string | null }
    | undefined;

  if (!result) {
    return NextResponse.json({ error: "처리 결과를 확인할 수 없습니다." }, { status: 500 });
  }

  if (!result.success) {
    const statusMap: Record<string, number> = {
      not_found: 404,
      invalid_direction: 400,
      already_processed: 409,
      family_not_found: 404,
      capacity_full: 403,
      conflict_existing_family: 409,
      other_guardian_conflict: 409,
      not_authorized: 403,
    };
    const messageMap: Record<string, string> = {
      not_found: "초대 요청을 찾을 수 없습니다.",
      invalid_direction: "잘못된 초대 방향입니다.",
      already_processed: "이미 처리된 초대입니다.",
      family_not_found: "가족 그룹이 존재하지 않습니다.",
      capacity_full: "가족 보호자 정원이 이미 가득 찼습니다.",
      conflict_existing_family: "기존 가족에 자녀 또는 다른 보호자가 있어 자동으로 전환할 수 없습니다. 고객센터에 문의해주세요.",
      other_guardian_conflict: "현재 가족에 다른 보호자가 있어 자동으로 전환할 수 없습니다.",
      not_authorized: "본인의 초대가 아닙니다.",
    };
    return NextResponse.json(
      { error: messageMap[result.reason] ?? "초대 수락에 실패했습니다." },
      { status: statusMap[result.reason] ?? 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    familyId: request.family_id,
    alreadyMember: result.reason === "already_member",
    previousFamilyId: result.previous_family_id ?? null,
  });
}
