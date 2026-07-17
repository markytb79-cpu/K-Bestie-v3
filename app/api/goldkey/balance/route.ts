import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBalance } from "@/lib/goldkey/ledger";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

// GET /api/goldkey/balance?childId=... — 유효(미만료·미소비) 황금열쇠 잔액
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const childId = req.nextUrl.searchParams.get("childId");
  if (!childId) {
    return NextResponse.json({ error: "childId required" }, { status: 400 });
  }

  const { allowed } = await requireChildAccess(supabase, user.id, childId);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const balance = await getBalance(childId);
    return NextResponse.json({ childId, balance });
  } catch {
    return NextResponse.json({ error: "잔액 조회 실패" }, { status: 500 });
  }
}

