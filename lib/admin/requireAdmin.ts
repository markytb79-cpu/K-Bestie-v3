import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin/isAdminEmail";

// Node 전용(createClient 사용) — app/api/admin/**/route.ts에서만 import할 것.
// middleware.ts(Edge 런타임)는 이 파일이 아니라 isAdminEmail.ts만 import해야 한다.
export async function requireAdmin(): Promise<NextResponse | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}
