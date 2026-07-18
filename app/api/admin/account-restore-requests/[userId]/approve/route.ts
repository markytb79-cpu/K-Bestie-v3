import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { userId } = await params;
  const supabase = await createClient();
  const { data: { user: adminUser } } = await supabase.auth.getUser();

  if (!adminUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc("admin_approve_account_restore", {
    p_admin_user_id: adminUser.id,
    p_admin_email: adminUser.email!,
    p_target_user_id: userId,
  });

  if (error) {
    console.error("[Approve Restore Error]", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  if (!data || !data[0].success) {
    return NextResponse.json({ error: data?.[0]?.reason }, { status: 400 });
  }

  return NextResponse.json({ success: true, message: "복구 승인 완료. 해당 사용자가 다시 로그인하면 정상 이용 가능합니다." });
}
