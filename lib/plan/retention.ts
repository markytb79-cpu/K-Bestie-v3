// 요금제별 유효 보존기간 계산 + 초과분(파기/복구 대상) 판정 순수 함수.
// 나이 판정 기준(앵커)은 호출자가 전달한다 — 세션 스코프(chat_sessions/chat_messages/
// daily_reports)는 chat_sessions.started_at, weekly_summaries는 자기 week_start.
// 이 모듈 자체는 앵커의 출처에 불가지(anchor-agnostic)하며 Date만 다룬다.

export type Tier = 1 | 2 | 3;

export interface RetentionResult {
  /** true면 무기한 보존(Care Premium 기본) — 파기 대상 판정 자체가 성립하지 않는다. */
  isPermanent: boolean;
  /** 유효 보존기간(개월). isPermanent가 true면 null. */
  months: number | null;
}

const START_TIER_MONTHS = 6; // Care Start 고정
const INSIGHT_BASE_YEARS = 3;
const INSIGHT_MAX_YEARS = 10; // 확장팩으로 최대 10년까지
const PREMIUM_FLOOR_MONTHS = 6; // 사용자가 축소 조정 시 하한

/** activePackCount는 결제 시스템이 아직 없어 항상 0으로 전달된다(무료 베타).
 *  시그니처는 향후 실제 확장팩 개수를 전달받을 수 있도록 열어둔다. */
export function getEffectiveRetention(tier: Tier, activePackCount: number): RetentionResult {
  const packCount = Math.max(0, Math.floor(activePackCount));

  if (tier === 1) {
    return { isPermanent: false, months: START_TIER_MONTHS };
  }

  if (tier === 2) {
    const years = Math.min(INSIGHT_BASE_YEARS + packCount, INSIGHT_MAX_YEARS);
    return { isPermanent: false, months: years * 12 };
  }

  // tier === 3 (Care Premium): 기본 영구 보존. 사용자가 직접 축소 조정한 경우에만
  // 유한 보존기간이 되며, 이 경우에도 하한은 6개월이다(이 함수는 조정값 자체를
  // 받지 않으므로 "조정 없음 = 영구"로 취급한다 — 조정 UI는 이번 PR 스코프 밖).
  return { isPermanent: true, months: null };
}

/** date에 개월 수를 더한 새 Date(UTC 기준 캘린더 연산 — 30일 근사가 아닌 정확한 월 단위). */
function addMonthsUtc(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export interface PurgeAnchor {
  /** 나이 판정 기준 시각 — 세션 스코프는 chat_sessions.started_at, weekly는 week_start. */
  anchorTs: Date;
}

/** anchor가 유효 보존기간을 초과했는지(=파기/파기유예 대상인지) 판정.
 *  Care Premium(영구)은 항상 false. */
export function isPurgeCandidate(anchor: PurgeAnchor, now: Date, retention: RetentionResult): boolean {
  if (retention.isPermanent || retention.months == null) return false;
  const cutoff = addMonthsUtc(anchor.anchorTs, retention.months);
  return cutoff.getTime() < now.getTime();
}

/** Premium 사용자가 보존기간을 직접 축소 조정할 때 하한(6개월)을 적용. */
export function clampPremiumRetentionMonths(requestedMonths: number): number {
  return Math.max(PREMIUM_FLOOR_MONTHS, requestedMonths);
}
