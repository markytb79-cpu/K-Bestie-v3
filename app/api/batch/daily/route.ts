import { NextRequest, NextResponse } from "next/server";
import { runDailyBatch } from "@/lib/batch";

export const runtime = "nodejs";
export const maxDuration = 300; // 배치는 최대 5분

/**
 * 새벽 4시 배치 수동 실행 진입점
 *
 * POST /api/batch/daily
 * Headers: Authorization: Bearer <BATCH_SECRET>
 * Body (선택):
 *   { "date": "YYYY-MM-DD", "forceWeekly": true }
 *   date 생략 시 오늘 KST 날짜 사용
 *
 * 수동 테스트:
 *   curl -X POST https://<host>/api/batch/daily \
 *     -H "Authorization: Bearer <BATCH_SECRET>" \
 *     -H "Content-Type: application/json" \
 *     -d '{"date":"2026-06-08","forceWeekly":false}'
 */
export async function POST(req: NextRequest) {
  // ── 인증 ────────────────────────────────────────────────────
  const secret = process.env.BATCH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "BATCH_SECRET env not set" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 파라미터 파싱 ────────────────────────────────────────────
  let body: { date?: string; forceWeekly?: boolean } = {};
  try { body = await req.json(); } catch { /* body 없으면 기본값 */ }

  // date 미지정 시 KST 오늘 날짜 (UTC+9)
  const targetDate = body.date ?? (() => {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
  })();

  // YYYY-MM-DD 형식 검증
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const forceWeekly = body.forceWeekly ?? false;

  // ── 배치 실행 ───────────────────────────────────────────────
  try {
    const result = await runDailyBatch(targetDate, forceWeekly);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error("[batch/daily] 실패:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
