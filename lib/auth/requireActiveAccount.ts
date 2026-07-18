import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function requireActiveAccount(userId: string): Promise<NextResponse | null> {
  const svc = createServiceClient();
  const { data: parent } = await svc
    .from("parents")
    .select("account_status")
    .eq("id", userId)
    .maybeSingle();

  if (!parent || (parent.account_status !== "ACTIVE" && parent.account_status !== "RESTORED")) {
    return NextResponse.json({ error: "탈퇴 처리된 계정입니다." }, { status: 403 });
  }

  return null;
}
