import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { consumeKeys } from "@/lib/goldkey/ledger";

export const runtime = "nodejs";

// POST /api/goldkey/consume { childId, count } — FIFO(만료 임박순) 차감
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { childId?: string; count?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { childId, count } = body;
  if (!childId || typeof count !== "number") {
    return NextResponse.json({ error: "childId and count required" }, { status: 400 });
  }

  try {
    const result = await consumeKeys(childId, count);
    if (!result.ok) {
      return NextResponse.json(result, { status: 409 });
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "차감 실패" }, { status: 500 });
  }
}
