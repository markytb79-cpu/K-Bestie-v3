-- [APPLIED 2026-07-11] 대표가 Supabase SQL Editor에서 직접 실행 완료.
-- 이 파일은 더 이상 "DRAFT/실행 금지" 상태가 아니며, 아래 DDL은 실제 DB에 이미 반영되어 있음.
-- (2026-07-12 조사 중 발견: 파일 주석과 실제 DB 상태가 불일치했던 문제를 여기서 정정함)
-- 목적: 요금제(tier)별 음성 방식 분기 — Tier1/2(STT+TTS) vs Tier3(Live API)
-- 기존 13개 승인 테이블 스키마 변경 아님(신규 테이블 1개 + parents에 컬럼 1개 추가)
--
-- [후속 변경 안내] parents.tier는 "가족 소유자(부모) 단위" 컬럼이라 형제자매 간 tier 분리가
-- 불가능하다는 구조적 문제가 발견되어, 아이 단위 tier는 child_profiles.tier로 이전됨.
-- → 20260712300000_child_profiles_tier.sql 참고. parents.tier 컬럼 자체는 결제 주체(부모)
-- 정보로 남겨두기로 결정(삭제하지 않음).

-- ================================================================
-- plans: 요금제 정의 (tier 1/2/3)
-- ================================================================
CREATE TABLE plans (
  tier                 INT PRIMARY KEY CHECK (tier IN (1, 2, 3)),
  name                 TEXT NOT NULL,
  price_krw            INT NOT NULL,
  voice_mode           TEXT NOT NULL CHECK (voice_mode IN ('stt_tts', 'live')),
  daily_report_detail  TEXT NOT NULL,   -- 예: '1min' | '3min' | 'premium'
  weekly_report_detail TEXT NOT NULL,   -- 예: '7min' | '20min' | 'premium'
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO plans (tier, name, price_krw, voice_mode, daily_report_detail, weekly_report_detail) VALUES
  (1, 'Care Start', 9900,   'stt_tts', '1min',    '7min'),
  (2, 'Insight',     14900, 'stt_tts', '3min',    '20min'),
  (3, 'Premium',     150000,'live',    'premium', 'premium');

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_plans"
  ON plans FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');
CREATE POLICY "service_write_plans"
  ON plans FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ================================================================
-- parents.tier: 계정(가족 소유자) 단위 요금제 연결. 기본값 1(Care Start)
-- ================================================================
ALTER TABLE parents
  ADD COLUMN tier INT NOT NULL DEFAULT 1 REFERENCES plans(tier);
