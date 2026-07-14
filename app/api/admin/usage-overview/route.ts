import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { fetchGcpBilling } from "@/lib/billing/gcpBilling";
import { REVENUE_MODE, VERCEL_FIXED_KRW_PER_MONTH, SUPABASE_FIXED_KRW_PER_MONTH } from "@/lib/plan/pricing";

export const runtime = "nodejs";

type Period = "today" | "7d" | "month";
type UsageEventRow = {
  id: string;
  child_id: string | null;
  tier: number | null;
  kind: string;
  duration_sec: number | null;
  char_count: number | null;
  token_in: number | null;
  token_out: number | null;
  est_cost_krw: number | null;
  created_at: string;
};

function periodRange(period: Period, now: Date): { from: Date; to: Date; days: number } {
  const to = new Date(now);
  const from = new Date(now);
  if (period === "today") {
    from.setHours(0, 0, 0, 0);
  } else if (period === "7d") {
    from.setDate(from.getDate() - 7);
  } else {
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
  }
  const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
  return { from, to, days };
}

function changeRate(current: number, prev: number): number | null {
  if (prev === 0) return current === 0 ? 0 : null; // 직전 기간 데이터가 없으면 비율 계산 불가
  return ((current - prev) / Math.abs(prev)) * 100;
}

function sumCost(events: UsageEventRow[]): number {
  return events.reduce((s, e) => s + (e.est_cost_krw ?? 0), 0);
}

/** 인프라 고정비 — month 기간엔 전액, today/7d엔 기간 일수만큼 일할 계산. */
function proratedInfraCost(monthlyKrw: number, period: Period, days: number): number {
  if (period === "month") return monthlyKrw;
  const DAYS_IN_MONTH = 30;
  return (monthlyKrw / DAYS_IN_MONTH) * days;
}

// GET /api/admin/usage-overview?period=today|7d|month&childId=xxx
// 관리자 대시보드 "사용량·비용" 탭 데이터 소스.
// childId 없음("전체 보기"): 회사 전체 손익 요약(+전기 대비 증감률) + 요금제별 인원 + 일별 매출/비용 추이
//   + 비용 항목별 분해(AI 4종 + 인프라 고정비, 비용 큰 순) + 서비스별 TOP10 유저 + 아이별 수익성 표.
// childId 있음(사용자 상세 드릴다운): 그 아이 하나의 세션 수 + 서비스별 사용량·비용만 반환.
// 단, 아이별 수익성 표(perChildProfitability)는 항상 전체 아이 목록 — childId 필터의 영향을 받지 않는다.
// 매출은 "가입 요금제" 기준(구독료 성격, 이번 기간 사용 여부와 무관) — child_profiles.tier 배정 금액을 그대로 합산.
// 지금은 전원 무료 제공 기간이라 실제 결제는 없고 "유료였다면"을 가정한 예상 매출이다(REVENUE_MODE 참고).
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const periodParam = req.nextUrl.searchParams.get("period");
  const period: Period = periodParam === "7d" || periodParam === "today" ? periodParam : "month";
  const filterChildId = req.nextUrl.searchParams.get("childId") || null;

  const now = new Date();
  const { from, to, days } = periodRange(period, now);
  // 직전 동기간 — 현재 기간과 동일한 길이만큼 바로 이전 구간.
  const prevTo = new Date(from);
  const prevFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));

  const service = createServiceClient();

  const [eventsRes, prevEventsRes, childrenRes, plansRes] = await Promise.all([
    service
      .from("usage_events")
      .select("id, child_id, tier, kind, duration_sec, char_count, token_in, token_out, est_cost_krw, created_at")
      .gte("created_at", from.toISOString())
      .lte("created_at", to.toISOString())
      .limit(20000),
    service
      .from("usage_events")
      .select("id, child_id, tier, kind, duration_sec, char_count, token_in, token_out, est_cost_krw, created_at")
      .gte("created_at", prevFrom.toISOString())
      .lt("created_at", prevTo.toISOString())
      .limit(20000),
    service.from("child_profiles").select("id, name, tier, created_at"),
    service.from("plans").select("tier, name, price_krw"),
  ]);

  const allEvents = (eventsRes.data ?? []) as UsageEventRow[];
  const prevEvents = (prevEventsRes.data ?? []) as UsageEventRow[];
  const children = childrenRes.data ?? [];
  const plans = plansRes.data ?? [];

  const priceByTier = new Map<number, { name: string; price: number }>(
    plans.map((p) => [p.tier, { name: p.name, price: p.price_krw }])
  );
  const childById = new Map<string, { name: string; tier: number; createdAt: string }>(
    children.map((c) => [c.id, { name: c.name, tier: c.tier, createdAt: c.created_at }])
  );

  // childId 필터가 있으면(아이 상세 드릴다운) 그 아이 이벤트로만, 없으면("전체 보기") 전체 이벤트로 계산.
  const events = filterChildId ? allEvents.filter((e) => e.child_id === filterChildId) : allEvents;

  // ── 서비스별(kind) 집계 + 일별 비용 (childId 필터 적용된 events 기준) ──
  const totalsByKind = { stt: 0, tts: 0, live_audio: 0, llm: 0 } as Record<string, number>;
  const countsByKind = { stt: 0, tts: 0, live_audio: 0, llm: 0 } as Record<string, number>;
  const dailyCostEstimate: Record<string, Record<string, number>> = {};
  const usageAmountByKind = { sttSec: 0, ttsChars: 0, liveSec: 0, llmTokenIn: 0, llmTokenOut: 0 };

  for (const e of events) {
    const kind = e.kind;
    const cost = e.est_cost_krw ?? 0;
    totalsByKind[kind] = (totalsByKind[kind] ?? 0) + cost;
    countsByKind[kind] = (countsByKind[kind] ?? 0) + 1;

    const day = e.created_at.slice(0, 10);
    dailyCostEstimate[day] = dailyCostEstimate[day] ?? { stt: 0, tts: 0, live_audio: 0, llm: 0 };
    if (dailyCostEstimate[day][kind] != null) dailyCostEstimate[day][kind] += cost;

    if (kind === "stt" && e.duration_sec) usageAmountByKind.sttSec += e.duration_sec;
    if (kind === "tts" && e.char_count) usageAmountByKind.ttsChars += e.char_count;
    if (kind === "live_audio" && e.duration_sec) usageAmountByKind.liveSec += e.duration_sec;
    if (kind === "llm") {
      if (e.token_in) usageAmountByKind.llmTokenIn += e.token_in;
      if (e.token_out) usageAmountByKind.llmTokenOut += e.token_out;
    }
  }

  // 아이별/서비스별 원가 집계는 항상 "전체" 이벤트(allEvents) 기준 — perChildProfitability와
  // topUsersByService가 childId 필터의 영향을 받지 않고 항상 전체 데이터를 보여주기 위함.
  const costByChildAll = new Map<string, number>();
  // key: `${kind}:${childId}` → { usage, costKrw }
  const usageByServiceChild = new Map<string, { childId: string; kind: string; usage: number; costKrw: number }>();
  for (const e of allEvents) {
    if (!e.child_id) continue;
    costByChildAll.set(e.child_id, (costByChildAll.get(e.child_id) ?? 0) + (e.est_cost_krw ?? 0));

    const key = `${e.kind}:${e.child_id}`;
    const usageAmount =
      e.kind === "tts" ? e.char_count ?? 0 : e.kind === "llm" ? (e.token_in ?? 0) + (e.token_out ?? 0) : e.duration_sec ?? 0;
    const existing = usageByServiceChild.get(key);
    if (existing) {
      existing.usage += usageAmount;
      existing.costKrw += e.est_cost_krw ?? 0;
    } else {
      usageByServiceChild.set(key, { childId: e.child_id, kind: e.kind, usage: usageAmount, costKrw: e.est_cost_krw ?? 0 });
    }
  }

  // 트래픽 — 기간 내 대화 세션 수(chat_sessions 시작 기준, childId 필터 적용)
  let sessionCountQuery = service
    .from("chat_sessions")
    .select("id", { count: "exact", head: true })
    .gte("started_at", from.toISOString())
    .lte("started_at", to.toISOString());
  if (filterChildId) sessionCountQuery = sessionCountQuery.eq("child_id", filterChildId);
  const { count: sessionCount } = await sessionCountQuery;

  const aiCostTotal = totalsByKind.stt + totalsByKind.tts + totalsByKind.live_audio + totalsByKind.llm;
  const vercelCost = proratedInfraCost(VERCEL_FIXED_KRW_PER_MONTH, period, days);
  const supabaseCost = proratedInfraCost(SUPABASE_FIXED_KRW_PER_MONTH, period, days);
  const totalCost = aiCostTotal + vercelCost + supabaseCost;

  // ── GCP 실제 청구액(STT/TTS) — 회사 전체 청구서라 아이 단위로는 못 쪼갠다.
  // childId 상세 드릴다운에서는 조회하지 않는다(그 아이만의 실제 청구액이 따로 없음).
  const gcpBilling = filterChildId
    ? { configured: false, rows: [] as { day: string; service: "stt" | "tts"; costKrw: number }[], totalsByService: { stt: 0, tts: 0 }, dataCutoffDate: now.toISOString().slice(0, 10), error: undefined as string | undefined }
    : await fetchGcpBilling({ from, to });

  // ── 요금제별 가입 인원 (가입 요금제 기준, 이번 기간 사용 여부와 무관) ──
  const enrolledByTier = new Map<number, number>();
  for (const c of children) {
    enrolledByTier.set(c.tier, (enrolledByTier.get(c.tier) ?? 0) + 1);
  }
  const byTier = Array.from(priceByTier.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([tier, plan]) => ({ tier, name: plan.name, priceKrw: plan.price, count: enrolledByTier.get(tier) ?? 0 }));

  // ── 손익 요약 — 매출은 "가입 요금제" 기준(구독료 성격, 이번 기간 사용 여부와 무관) ──
  let projectedRevenue = 0;
  if (filterChildId) {
    const child = childById.get(filterChildId);
    projectedRevenue = child ? priceByTier.get(child.tier)?.price ?? 0 : 0;
  } else {
    projectedRevenue = byTier.reduce((sum, t) => sum + t.priceKrw * t.count, 0);
  }
  const netProfit = projectedRevenue - totalCost;

  // ── 직전 동기간 대비 증감률 ──
  // 비용: 직전 기간 usage_events 합계 + 인프라 고정비(동일 로직).
  const prevEventsScoped = filterChildId ? prevEvents.filter((e) => e.child_id === filterChildId) : prevEvents;
  const prevAiCost = sumCost(prevEventsScoped);
  const prevTotalCost = prevAiCost + vercelCost + supabaseCost; // 고정비는 기간 길이만 같으면 동일
  // 매출: 직전 기간 "종료 시점" 이전에 가입(created_at)한 아이만 카운트 — 이 기간 동안의 신규가입 증가분을 반영.
  let prevRevenue = 0;
  if (filterChildId) {
    const child = childById.get(filterChildId);
    const existedBefore = child && new Date(child.createdAt) < prevTo;
    prevRevenue = existedBefore && child ? priceByTier.get(child.tier)?.price ?? 0 : 0;
  } else {
    const prevEnrolledByTier = new Map<number, number>();
    for (const c of children) {
      if (new Date(c.created_at) < prevTo) {
        prevEnrolledByTier.set(c.tier, (prevEnrolledByTier.get(c.tier) ?? 0) + 1);
      }
    }
    prevRevenue = Array.from(prevEnrolledByTier.entries()).reduce((sum, [tier, count]) => {
      const price = priceByTier.get(tier)?.price ?? 0;
      return sum + price * count;
    }, 0);
  }
  const prevProfit = prevRevenue - prevTotalCost;

  // ── 일별 매출·비용 추이(글랜스용) — 매출은 기간 내 총 매출을 일수만큼 균등 분배한 참고선.
  const dailyRevenuePerDay = projectedRevenue / days;
  const dailyInfraPerDay = (vercelCost + supabaseCost) / days;
  const dailyTrend = Object.keys(dailyCostEstimate)
    .sort()
    .map((day) => {
      const c = dailyCostEstimate[day];
      return { day, revenueKrw: dailyRevenuePerDay, costKrw: c.stt + c.tts + c.live_audio + c.llm + dailyInfraPerDay };
    });

  // ── 비용 항목별 분해 — AI 4종 + 인프라 고정비, 비용 큰 순 정렬 + 전체 대비 비중% ──
  type CostBreakdownItem = {
    key: "stt" | "tts" | "live_audio" | "llm" | "vercel" | "supabase";
    label: string;
    category: "ai" | "infra";
    usage: number;
    usageUnit: string;
    ourEstimateKrw: number;
    gcpActualKrw: number | null;
    confirmedCostKrw: number;
    note?: string;
  };
  const rawBreakdown: CostBreakdownItem[] = [
    {
      key: "stt",
      label: "STT",
      category: "ai",
      usage: usageAmountByKind.sttSec,
      usageUnit: "sec",
      ourEstimateKrw: totalsByKind.stt,
      gcpActualKrw: gcpBilling.configured ? gcpBilling.totalsByService.stt : null,
      confirmedCostKrw: gcpBilling.configured ? gcpBilling.totalsByService.stt : totalsByKind.stt,
    },
    {
      key: "tts",
      label: "TTS",
      category: "ai",
      usage: usageAmountByKind.ttsChars,
      usageUnit: "chars",
      ourEstimateKrw: totalsByKind.tts,
      gcpActualKrw: gcpBilling.configured ? gcpBilling.totalsByService.tts : null,
      confirmedCostKrw: gcpBilling.configured ? gcpBilling.totalsByService.tts : totalsByKind.tts,
    },
    {
      key: "live_audio",
      label: "Gemini 라이브",
      category: "ai",
      usage: usageAmountByKind.liveSec,
      usageUnit: "sec",
      ourEstimateKrw: totalsByKind.live_audio,
      gcpActualKrw: null,
      confirmedCostKrw: totalsByKind.live_audio,
      note: "AI Studio 월말 대조 필요",
    },
    {
      key: "llm",
      label: "LLM(텍스트)",
      category: "ai",
      usage: usageAmountByKind.llmTokenIn + usageAmountByKind.llmTokenOut,
      usageUnit: "tokens",
      ourEstimateKrw: totalsByKind.llm,
      gcpActualKrw: null,
      confirmedCostKrw: totalsByKind.llm,
      note: "AI Studio 월말 대조 필요",
    },
    {
      key: "vercel",
      label: "Vercel(인프라)",
      category: "infra",
      usage: days,
      usageUnit: "days",
      ourEstimateKrw: vercelCost,
      gcpActualKrw: null,
      confirmedCostKrw: vercelCost,
      note: "실제 청구서 확인 전 근사치",
    },
    {
      key: "supabase",
      label: "Supabase(인프라)",
      category: "infra",
      usage: days,
      usageUnit: "days",
      ourEstimateKrw: supabaseCost,
      gcpActualKrw: null,
      confirmedCostKrw: supabaseCost,
      note: "실제 청구서 확인 전 근사치",
    },
  ];
  const breakdownTotal = rawBreakdown.reduce((s, i) => s + i.confirmedCostKrw, 0);
  const costBreakdown = rawBreakdown
    .map((i) => ({ ...i, sharePct: breakdownTotal > 0 ? (i.confirmedCostKrw / breakdownTotal) * 100 : 0 }))
    .sort((a, b) => b.confirmedCostKrw - a.confirmedCostKrw);

  // ── 서비스별 TOP10 유저 — AI 4종 각각 사용량 기준 상위 10명(이름/사용량/비용) ──
  const topUsersByService: Record<string, { childId: string; name: string; usage: number; costKrw: number }[]> = {
    stt: [],
    tts: [],
    live_audio: [],
    llm: [],
  };
  for (const kind of Object.keys(topUsersByService)) {
    const rows = Array.from(usageByServiceChild.values())
      .filter((r) => r.kind === kind)
      .sort((a, b) => b.costKrw - a.costKrw)
      .slice(0, 10)
      .map((r) => ({
        childId: r.childId,
        name: childById.get(r.childId)?.name ?? "(알 수 없음)",
        usage: r.usage,
        costKrw: r.costKrw,
      }));
    topUsersByService[kind] = rows;
  }

  // ── 아이별 수익성(드릴다운) — 항상 "전체 아이 목록", childId 필터 영향 없음.
  // 매출은 가입 요금제 기준(사용 여부 무관), 원가는 이번 기간 usage_events 합계.
  const perChild = children.map((child) => {
    const cost = costByChildAll.get(child.id) ?? 0;
    const tier = child.tier ?? 1;
    const plan = priceByTier.get(tier);
    const priceKrw = plan?.price ?? 0;
    const margin = priceKrw - cost;
    return {
      childId: child.id,
      name: child.name,
      tier,
      planName: plan?.name ?? `Tier ${tier}`,
      createdAt: child.created_at,
      priceKrw,
      costKrw: cost,
      marginKrw: margin,
      marginRate: priceKrw > 0 ? (margin / priceKrw) * 100 : 0,
    };
  }).sort((a, b) => a.marginKrw - b.marginKrw);

  const selectedChild = filterChildId ? childById.get(filterChildId) ?? null : null;

  return NextResponse.json({
    period,
    range: { from: from.toISOString(), to: to.toISOString() },
    scope: filterChildId
      ? { mode: "child", childId: filterChildId, childName: selectedChild?.name ?? "(알 수 없음)" }
      : { mode: "all" },
    profitSummary: {
      revenueMode: REVENUE_MODE,
      projectedRevenueKrw: projectedRevenue,
      costKrw: totalCost,
      netProfitKrw: netProfit,
      changeRate: {
        revenue: changeRate(projectedRevenue, prevRevenue),
        cost: changeRate(totalCost, prevTotalCost),
        profit: changeRate(netProfit, prevProfit),
      },
    },
    subSummary: {
      totalChildren: children.length,
      byTier,
    },
    dailyTrend,
    costBreakdown,
    topUsersByService,
    traffic: {
      sessionCount: sessionCount ?? 0,
      sttCount: countsByKind.stt,
      ttsCount: countsByKind.tts,
      liveCount: countsByKind.live_audio,
      llmCount: countsByKind.llm,
    },
    perChildProfitability: perChild,
    gcpBillingError: gcpBilling.error ?? null,
  });
}
