import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // 인증 검증
  const secret = process.env.BATCH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "BATCH_SECRET env not set" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabaseAdmin = createServiceClient();
    
    // 1. 파기 대상 찾기
    const { data: parents, error: pError } = await supabaseAdmin
      .from("parents")
      .select("id, email, name, account_status, purge_scheduled_at")
      .eq("account_status", "WITHDRAWN_PENDING")
      .lte("purge_scheduled_at", new Date().toISOString());

    if (pError) {
      console.error("[Account Purge Error] parents fetch failed:", pError);
      return NextResponse.json({ error: "parents fetch error" }, { status: 500 });
    }

    if (!parents || parents.length === 0) {
      return NextResponse.json({ success: true, count: 0, message: "No accounts to purge" });
    }

    let purgedCount = 0;

    // 2. 각 대상에 대해 순차적으로 물리삭제 및 정리 수행
    for (const parent of parents) {
      try {
        // 새 RPC 호출: 원자적으로 가족 물리삭제 및 부모 계정 비식별화/상태 변경
        const { error: purgeRpcError } = await supabaseAdmin.rpc("purge_account_family_data", {
          p_user_id: parent.id,
        });

        if (purgeRpcError) {
          console.error(`[Account Purge Error] RPC failed for user ${parent.id}:`, purgeRpcError);
          continue;
        }

        // admin_audit_log 이메일 비식별화
        await supabaseAdmin
          .from("admin_audit_log")
          .update({ admin_email: `purged-${parent.id.substring(0, 8)}@deleted.local` })
          .eq("admin_user_id", parent.id);

        // auth.users 물리 삭제 (best-effort)
        // 실패하더라도 DB 레벨에서는 PURGED 상태로 잘 분리되어 있으므로 서비스 지장 없음
        const { error: delError } = await supabaseAdmin.auth.admin.deleteUser(parent.id);
        if (delError) {
          console.error(`[Account Purge Warning] Failed to delete auth user ${parent.id}, but DB purge succeeded.`, delError);
        }

        // 파기 감사 로그 기록 (기존과 동일)
        await supabaseAdmin
          .from("admin_audit_log")
          .insert({
            admin_user_id: parent.id,
            admin_email: `purged-${parent.id.substring(0, 8)}@deleted.local`,
            action: "account_purged",
            target_user_id: parent.id
          });

        purgedCount++;
      } catch (err) {
        console.error(`[Account Purge Error] Exception processing user ${parent.id}`, err);
      }
    }

    return NextResponse.json({ success: true, count: purgedCount });
  } catch (err: any) {
    console.error("[Account Purge Exception]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
