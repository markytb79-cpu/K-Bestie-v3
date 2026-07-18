import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireActiveAccount } from "@/lib/auth/requireActiveAccount";

export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ children: [] });

    const activeCheck = await requireActiveAccount(user.id);
    if (activeCheck) {
      // 이 라우트는 { children: [] } 포맷을 유지할 수도 있고, 
      // 명시적인 에러를 위해 activeCheck 응답을 바로 반환할 수도 있음.
      // prompt에 "403과 함께 '탈퇴 처리된 계정입니다' 수준의 에러 반환" 지시가 있으므로 
      // activeCheck를 그대로 반환.
      return activeCheck;
    }

    const { data: children, error } = await supabase
      .from("child_profiles")
      .select("id, name, grade, interests, family_id")
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ children: [] });
    return NextResponse.json({ children: children ?? [] });
  } catch {
    return NextResponse.json({ children: [] });
  }
}
