// 유효 보존기간 계산 + 파기 대상 판정 유닛 테스트.
// 이 저장소에 테스트 러너가 아직 없어(package.json 확인) 새 의존성 추가 없이
// Node 내장 test runner(node:test) + 네이티브 TS 스트리핑으로 실행한다:
//   node --experimental-strip-types --test lib/plan/retention.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { getEffectiveRetention, isPurgeCandidate, clampPremiumRetentionMonths } from "./retention.ts";

test("Care Start(tier 1)는 항상 6개월 고정, 확장팩과 무관", () => {
  assert.deepEqual(getEffectiveRetention(1, 0), { isPermanent: false, months: 6 });
  assert.deepEqual(getEffectiveRetention(1, 5), { isPermanent: false, months: 6 });
});

test("Care Insight(tier 2) 확장팩 경계값 — 0/1/n/상한10년", () => {
  assert.deepEqual(getEffectiveRetention(2, 0), { isPermanent: false, months: 36 }); // 3년
  assert.deepEqual(getEffectiveRetention(2, 1), { isPermanent: false, months: 48 }); // 4년
  assert.deepEqual(getEffectiveRetention(2, 6), { isPermanent: false, months: 108 }); // 9년
  assert.deepEqual(getEffectiveRetention(2, 7), { isPermanent: false, months: 120 }); // 상한 10년
  assert.deepEqual(getEffectiveRetention(2, 100), { isPermanent: false, months: 120 }); // 상한 초과분 클램프
});

test("Care Premium(tier 3)은 기본 영구 — activePackCount 무관", () => {
  assert.deepEqual(getEffectiveRetention(3, 0), { isPermanent: true, months: null });
  assert.deepEqual(getEffectiveRetention(3, 3), { isPermanent: true, months: null });
});

test("다운그레이드 직후: activePackCount는 항상 0으로 전달(결제 시스템 없음)", () => {
  // mission/report 라우트 등 실제 호출부는 activePackCount=0 고정 — 여기서는 계산기 자체의 정확성만 검증.
  const r = getEffectiveRetention(2, 0);
  assert.equal(r.months, 36);
});

test("isPurgeCandidate: 보존기간 이내는 파기 대상 아님", () => {
  const retention = getEffectiveRetention(1, 0); // 6개월
  const anchorTs = new Date("2026-01-15T00:00:00Z");
  const now = new Date("2026-06-01T00:00:00Z"); // 약 4.5개월 경과
  assert.equal(isPurgeCandidate({ anchorTs }, now, retention), false);
});

test("isPurgeCandidate: 보존기간 초과는 파기 대상", () => {
  const retention = getEffectiveRetention(1, 0); // 6개월
  const anchorTs = new Date("2026-01-15T00:00:00Z");
  const now = new Date("2026-08-01T00:00:00Z"); // 6.5개월 경과
  assert.equal(isPurgeCandidate({ anchorTs }, now, retention), true);
});

test("isPurgeCandidate: KST 자정 경계 — UTC 환산 앵커/now로 정확히 판정", () => {
  const retention = getEffectiveRetention(1, 0); // 6개월
  // KST 2026-01-15 09:00 = UTC 2026-01-15 00:00
  const anchorTs = new Date("2026-01-15T00:00:00Z");
  // KST 2026-07-15 08:59:59(=경계 직전, UTC 2026-07-14 23:59:59) → 아직 6개월 미만
  const justBefore = new Date("2026-07-14T23:59:59Z");
  // KST 2026-07-15 09:00:01(=경계 직후, UTC 2026-07-15 00:00:01) → 6개월 초과
  const justAfter = new Date("2026-07-15T00:00:01Z");
  assert.equal(isPurgeCandidate({ anchorTs }, justBefore, retention), false);
  assert.equal(isPurgeCandidate({ anchorTs }, justAfter, retention), true);
});

test("isPurgeCandidate: Care Premium(영구)은 절대 파기 대상 아님", () => {
  const retention = getEffectiveRetention(3, 0);
  const anchorTs = new Date("2000-01-01T00:00:00Z");
  const now = new Date("2030-01-01T00:00:00Z");
  assert.equal(isPurgeCandidate({ anchorTs }, now, retention), false);
});

test("clampPremiumRetentionMonths: 하한 6개월 강제", () => {
  assert.equal(clampPremiumRetentionMonths(3), 6);
  assert.equal(clampPremiumRetentionMonths(12), 12);
});

// ── 스탬프↔복구 대칭성 검증(단계4 선행 계약 테스트) ──
// 스탬프(다운그레이드로 보존기간 축소) 시점엔 초과 판정이던 데이터가, 복구(재상향으로
// 보존기간 재확대) 시점엔 동일 앵커/동일 계산기로 재판정했을 때 반드시 "초과 아님"으로
// 뒤집혀야 한다(대칭 역연산). 그렇지 않으면 복구해야 할 데이터가 복구되지 않는다.
test("다운그레이드로 초과 판정된 앵커가 재상향 후 동일 계산기로는 초과 아님으로 뒤집힘", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const anchorTs = new Date("2026-01-01T00:00:00Z"); // now 기준 5개월 경과

  const afterDowngrade = getEffectiveRetention(1, 0); // Start=6개월 → 아직 미초과
  const afterReupgrade = getEffectiveRetention(2, 0); // Insight=36개월 재상향 → 당연히 미초과

  // 먼저 극단적으로 짧은 보존기간(가상 1개월)으로 스탬프 대상이 됨을 확인
  const veryShort = { isPermanent: false, months: 1 };
  assert.equal(isPurgeCandidate({ anchorTs }, now, veryShort), true);

  // 같은 anchor/now를 재상향된 보존기간(Insight)으로 재판정하면 반드시 false(복구 대상)
  assert.equal(isPurgeCandidate({ anchorTs }, now, afterReupgrade), false);
  assert.equal(isPurgeCandidate({ anchorTs }, now, afterDowngrade), false);
});
