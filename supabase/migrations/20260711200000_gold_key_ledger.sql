-- 초안 (DDL DRAFT ONLY) — 실행 금지, 대표 승인 후 대표가 직접 실행할 것
-- 목적: 황금열쇠 원장 — 개별 획득/만료/소비 기록 (출석체크·미션완료 적립, 7일 만료, FIFO 차감)
-- 적립 규칙: 하루 최대 3개 = 출석 1개(하루 1회, Asia/Seoul 자정 기준) + 미션완료 최대 2개
-- 유효잔액 = expires_at > now() AND consumed = false 인 행 개수
-- 차감(소비) = 만료 임박(expires_at 오름차순) 순으로 우선 처리
-- FK: child_profiles(id) — 실제 아이 계정 테이블

CREATE TABLE gold_key_ledger (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id    UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL CHECK (reason IN ('attendance', 'mission')),
  earned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed    BOOLEAN NOT NULL DEFAULT false,
  consumed_at TIMESTAMPTZ
);

-- 유효잔액 조회 / FIFO 차감 최적화: 미소비 행을 child별 만료순으로 스캔
CREATE INDEX idx_gold_key_ledger_balance
  ON gold_key_ledger (child_id, expires_at)
  WHERE consumed = false;

-- 일일 적립 한도 판정(출석 중복·미션 2개 한도) 조회용
CREATE INDEX idx_gold_key_ledger_earned
  ON gold_key_ledger (child_id, reason, earned_at);

-- ================================================================
-- RLS: service_role 전체 접근, 아이 본인/부모(가족구성원)는 읽기만
-- (적립·차감은 전부 service_role API를 통해서만 — 클라이언트 직접 쓰기 금지)
-- ================================================================
ALTER TABLE gold_key_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gold_key_ledger_select"
  ON gold_key_ledger FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = gold_key_ledger.child_id AND fm.user_id = auth.uid()
    )
  );

CREATE POLICY "gold_key_ledger_write"
  ON gold_key_ledger FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
