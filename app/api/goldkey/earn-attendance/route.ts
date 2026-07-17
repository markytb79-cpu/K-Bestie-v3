import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { earnAttendanceKey } from "@/lib/goldkey/ledger";
import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

// POST /api/goldkey/earn-attendance { childId } — 출석 적립(하루 1회, 중복 방지)
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { childId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { childId } = body;
  if (!childId) {
    return NextResponse.json({ error: "childId required" }, { status: 400 });
  }

  const { allowed } = await requireChildAccess(supabase, user.id, childId);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await earnAttendanceKey(childId);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "출석 적립 실패" }, { status: 500 });
  }
}

