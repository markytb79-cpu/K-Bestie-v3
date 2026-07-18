-- DRAFT: 실행 전 사용자 승인 필요, 아직 미적용
-- 목적: 20260716200000_goldkey_ky_play_system.sql이 제안했던 quantity/remaining_quantity 원장 재설계를
-- 폐기하고, 20260711200000_gold_key_ledger.sql의 단위-row 모델(1행=열쇠 1개, consumed boolean)을 정규
-- 기준으로 삼아 KY 놀이 시스템이 필요로 하는 것(놀이 세션, 소비/환불, 멱등성)을 데이터 보존형
-- ALTER/신규 테이블/RPC로 추가한다. 기존 gold_key_ledger 컬럼·제약·인덱스는 전혀 건드리지 않는다.
--
-- 지급(record_v2_mission_answer, 20260717170000)과 이 파일의 소비/환불 RPC는 전부 동일한 child_id
-- 단위 advisory transaction lock(pg_advisory_xact_lock(hashtext(child_id::text)))을 가장 먼저 획득한
-- 뒤에만 잔액에 영향을 주는 판단·행 잠금·쓰기를 수행한다 — 이렇게 해야 지급·소비·환불이 서로 경쟁해도
-- 활성잔액 22개 상한/일일 지급 한도/소비 가능 여부가 항상 락 획득 후의 최신 상태를 기준으로 판정된다.

-- ================================================================
-- 1. gold_key_ledger — 데이터 보존형 ALTER만 (컬럼 추가 1개, 기존 컬럼/제약/인덱스 무변경)
-- ================================================================
-- k_play_sessions를 다음 섹션에서 만들기 때문에 FK는 그 테이블 생성 후 추가한다(아래 3번 참고).
ALTER TABLE gold_key_ledger
  ADD COLUMN consumed_by_play_session_id UUID;

COMMENT ON COLUMN gold_key_ledger.consumed_by_play_session_id IS
  'KY 놀이 세션이 이 열쇠를 소비한 경우 그 세션 id(k_play_sessions.id). 일반 /api/goldkey/consume 경유
   소비(놀이 세션과 무관)나 미소비 상태는 NULL로 남는다.';

-- ================================================================
-- 2. gold_key_consumptions — 개별 원장 행이 아니라 "소비/환불 작업 헤더 + 감사 이력"
-- ================================================================
-- 1건 of consume_gold_keys 호출 = 이 테이블에 1행. 그 호출이 실제로 잠근/소비한 개별 gold_key_ledger
-- 행들은 gold_key_ledger.consumed_by_play_session_id로 역참조한다(별도 매핑 테이블 없음 — 단위-row라
-- 필요 없음). idempotency_key로 같은 소비 요청의 중복 처리를 방지한다.
CREATE TABLE gold_key_consumptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id          UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  play_session_id   UUID, -- FK는 3번 테이블 생성 후 아래에서 추가. NULL 허용(일반 소비 경로는 놀이 세션 없음)
  idempotency_key   TEXT NOT NULL,
  requested_count   INTEGER NOT NULL CHECK (requested_count > 0),
  consumed_count    INTEGER NOT NULL DEFAULT 0 CHECK (consumed_count >= 0),
  refunded_count    INTEGER NOT NULL DEFAULT 0 CHECK (refunded_count >= 0 AND refunded_count <= consumed_count),
  status            TEXT NOT NULL CHECK (status IN ('completed', 'insufficient', 'refunded', 'partially_refunded')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uidx_gold_key_consumptions_idempotency ON gold_key_consumptions (idempotency_key);
CREATE INDEX idx_gold_key_consumptions_child ON gold_key_consumptions (child_id, created_at DESC);
CREATE INDEX idx_gold_key_consumptions_session ON gold_key_consumptions (play_session_id) WHERE play_session_id IS NOT NULL;

-- 같은 놀이 세션이 status='insufficient'가 아닌 상태로 두 번 이상 소비 헤더를 갖지 못하게 하는 DB 레벨 안전장치, RPC 레벨 사전체크의 백스톱
CREATE UNIQUE INDEX uidx_gold_key_consumptions_active_session
  ON gold_key_consumptions (child_id, play_session_id)
  WHERE play_session_id IS NOT NULL AND status <> 'insufficient';

COMMENT ON TABLE gold_key_consumptions IS
  '소비/환불 "작업 단위" 헤더 + 감사 이력. 개별 gold_key_ledger 행이 아니라 consume_gold_keys/
   refund_gold_keys RPC 호출 1건당 1행. requested_count/consumed_count/refunded_count로 부분 상태를
   추적하되, 현재 구현된 consume_gold_keys는 all-or-nothing(요청 개수를 다 채우지 못하면 0개 소비)이라
   consumed_count는 항상 0 또는 requested_count 둘 중 하나다.';

-- ================================================================
-- 3. k_play_sessions — KY 놀이 세션 (20260716200000 원안 그대로, gold_key_ledger와 무관해 충돌 없음)
-- ================================================================
CREATE TABLE k_play_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id        UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  play_type       TEXT NOT NULL CHECK (play_type IN ('comic_book', 'quiz', 'hairstyle', 'mbti')),
  keys_cost       INTEGER NOT NULL CHECK (
    (play_type = 'comic_book' AND keys_cost = 2) OR
    (play_type = 'quiz'       AND keys_cost = 2) OR
    (play_type = 'hairstyle'  AND keys_cost = 3) OR
    (play_type = 'mbti'       AND keys_cost = 3)
  ),
  status          TEXT NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress', 'completed', 'expired', 'refunded')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  progress_state  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE gold_key_ledger
  ADD CONSTRAINT gold_key_ledger_consumed_by_play_session_fk
  FOREIGN KEY (consumed_by_play_session_id) REFERENCES k_play_sessions(id) ON DELETE SET NULL;

ALTER TABLE gold_key_consumptions
  ADD CONSTRAINT gold_key_consumptions_play_session_fk
  FOREIGN KEY (play_session_id) REFERENCES k_play_sessions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX idx_k_play_sessions_one_active
  ON k_play_sessions (child_id, play_type)
  WHERE status = 'in_progress';

CREATE INDEX idx_k_play_sessions_child_completed
  ON k_play_sessions (child_id, completed_at DESC)
  WHERE status = 'completed';

CREATE INDEX idx_k_play_sessions_expiring
  ON k_play_sessions (expires_at)
  WHERE status = 'in_progress';

CREATE OR REPLACE FUNCTION public.set_k_play_sessions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_k_play_sessions_updated_at
  BEFORE UPDATE ON k_play_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_k_play_sessions_updated_at();

CREATE OR REPLACE FUNCTION public.expire_stale_k_sessions()
RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH updated AS (
    UPDATE k_play_sessions
    SET status = 'expired'
    WHERE status = 'in_progress' AND expires_at <= now()
    RETURNING id
  )
  SELECT count(*)::INTEGER FROM updated;
$$;
REVOKE EXECUTE ON FUNCTION public.expire_stale_k_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_stale_k_sessions() TO service_role;

-- ================================================================
-- 4. consume_gold_keys — 원자적 소비 RPC (lock-first, deterministic FOR UPDATE, all-or-nothing)
-- ================================================================
-- 순서: (0) child_id 단위 advisory lock 최우선 획득 → (1) idempotency_key로 기존 처리 이력 조회
-- (완료/환불된 요청이면 재소비 없이 그 결과 그대로 반환) → (2) 대상 행을 만료임박순+id 보조정렬(결정론적
-- 순서)으로 FOR UPDATE 잠금 → (3) 부족하면 0개 소비 처리(all-or-nothing), 충분하면 전부 consumed=true.
CREATE OR REPLACE FUNCTION public.consume_gold_keys(
  p_child_id UUID,
  p_amount INTEGER,
  p_idempotency_key TEXT,
  p_play_session_id UUID DEFAULT NULL
) RETURNS TABLE (
  success BOOLEAN,
  consumed_count INTEGER,
  balance INTEGER,
  header_id UUID,
  reason TEXT
) AS $$
DECLARE
  v_existing_id UUID;
  v_existing_status TEXT;
  v_existing_consumed_count INTEGER;
  v_ids UUID[];
  v_header_id UUID;
  v_balance INTEGER;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    SELECT COUNT(*)::INT INTO v_balance FROM gold_key_ledger
      WHERE child_id = p_child_id AND consumed = false AND expires_at > now();
    RETURN QUERY SELECT false, 0, v_balance, NULL::UUID, 'invalid_amount'::text;
    RETURN;
  END IF;

  -- (0) child_id 단위 advisory lock 최우선 획득 — 이 함수의 첫 번째 실질 동작이어야 한다.
  PERFORM pg_advisory_xact_lock(hashtext(p_child_id::text));

  -- (1-신규) play_session_id 기반 중복 소비 사전 체크 (p_play_session_id IS NOT NULL인 경우)
  IF p_play_session_id IS NOT NULL THEN
    SELECT id, status, consumed_count
    INTO v_existing_id, v_existing_status, v_existing_consumed_count
    FROM gold_key_consumptions
    WHERE child_id = p_child_id
      AND play_session_id = p_play_session_id
      AND status <> 'insufficient'
    FOR UPDATE;

    IF v_existing_id IS NOT NULL THEN
      SELECT COUNT(*)::INT INTO v_balance FROM gold_key_ledger
        WHERE child_id = p_child_id AND consumed = false AND expires_at > now();
      RETURN QUERY SELECT true, v_existing_consumed_count, v_balance, v_existing_id, 'already_processed'::text;
      RETURN;
    END IF;
  END IF;

  -- (2) 기존 idempotency_key 기반 체크 — 락 획득 후 조회(락 이전 조회는 신뢰하지 않는다)
  SELECT id, status, consumed_count
  INTO v_existing_id, v_existing_status, v_existing_consumed_count
  FROM gold_key_consumptions
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_existing_id IS NOT NULL AND v_existing_status IN ('completed', 'refunded', 'partially_refunded') THEN
    SELECT COUNT(*)::INT INTO v_balance FROM gold_key_ledger
      WHERE child_id = p_child_id AND consumed = false AND expires_at > now();
    RETURN QUERY SELECT true, v_existing_consumed_count, v_balance, v_existing_id, 'already_processed'::text;
    RETURN;
  END IF;
  -- v_existing_status = 'insufficient'였던 요청의 재시도이거나(v_existing_id IS NOT NULL),
  -- 완전히 새 요청(v_existing_id IS NULL)인 경우 아래로 계속 진행.

  -- (2) 대상 행 잠금 — 만료임박순 + id 보조정렬(결정론적 순서, 데드락 방지)
  SELECT array_agg(id) INTO v_ids FROM (
    SELECT id FROM gold_key_ledger
    WHERE child_id = p_child_id AND consumed = false AND expires_at > now()
    ORDER BY expires_at ASC, id ASC
    LIMIT p_amount
    FOR UPDATE
  ) sub;

  IF v_ids IS NULL OR array_length(v_ids, 1) < p_amount THEN
    IF v_existing_id IS NOT NULL THEN
      UPDATE gold_key_consumptions SET status = 'insufficient', updated_at = now() WHERE id = v_existing_id;
      v_header_id := v_existing_id;
    ELSE
      INSERT INTO gold_key_consumptions (child_id, play_session_id, idempotency_key, requested_count, consumed_count, status)
      VALUES (p_child_id, p_play_session_id, p_idempotency_key, p_amount, 0, 'insufficient')
      RETURNING id INTO v_header_id;
    END IF;

    SELECT COUNT(*)::INT INTO v_balance FROM gold_key_ledger
      WHERE child_id = p_child_id AND consumed = false AND expires_at > now();
    RETURN QUERY SELECT false, 0, v_balance, v_header_id, 'insufficient_balance'::text;
    RETURN;
  END IF;

  UPDATE gold_key_ledger
  SET consumed = true, consumed_at = now(), consumed_by_play_session_id = p_play_session_id
  WHERE id = ANY(v_ids);

  IF v_existing_id IS NOT NULL THEN
    UPDATE gold_key_consumptions
    SET consumed_count = p_amount, status = 'completed', updated_at = now()
    WHERE id = v_existing_id;
    v_header_id := v_existing_id;
  ELSE
    INSERT INTO gold_key_consumptions (child_id, play_session_id, idempotency_key, requested_count, consumed_count, status)
    VALUES (p_child_id, p_play_session_id, p_idempotency_key, p_amount, p_amount, 'completed')
    RETURNING id INTO v_header_id;
  END IF;

  SELECT COUNT(*)::INT INTO v_balance FROM gold_key_ledger
    WHERE child_id = p_child_id AND consumed = false AND expires_at > now();
  RETURN QUERY SELECT true, p_amount, v_balance, v_header_id, 'ok'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.consume_gold_keys(UUID, INTEGER, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_gold_keys(UUID, INTEGER, TEXT, UUID) TO service_role;

-- ================================================================
-- 5. refund_gold_keys — 원자적 환불 RPC (lock-first, 전액 환불만 지원, 중복 환불 방지)
-- ================================================================
CREATE OR REPLACE FUNCTION public.refund_gold_keys(
  p_play_session_id UUID
) RETURNS TABLE (
  success BOOLEAN,
  refunded_count INTEGER,
  header_id UUID,
  reason TEXT
) AS $$
DECLARE
  v_child_id UUID;
  v_header_id UUID;
  v_status TEXT;
  v_consumed_count INTEGER;
  v_already_refunded INTEGER;
  v_to_refund INTEGER;
BEGIN
  -- 락 대상(child_id)을 정하기 위한 가벼운 사전 조회 — 이 값 자체로 어떤 상태 판단도 하지 않는다.
  SELECT child_id INTO v_child_id
  FROM gold_key_consumptions
  WHERE play_session_id = p_play_session_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_child_id IS NULL THEN
    RETURN QUERY SELECT false, 0, NULL::UUID, 'not_found'::text;
    RETURN;
  END IF;

  -- child_id 단위 advisory lock 최우선 획득
  PERFORM pg_advisory_xact_lock(hashtext(v_child_id::text));

  -- 락 획득 후 최신 상태 재조회(위 사전 조회 값은 상태 판단에 재사용하지 않는다) + FOR UPDATE
  SELECT id, status, consumed_count, refunded_count
  INTO v_header_id, v_status, v_consumed_count, v_already_refunded
  FROM gold_key_consumptions
  WHERE play_session_id = p_play_session_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_status = 'refunded' THEN
    RETURN QUERY SELECT false, 0, v_header_id, 'already_refunded'::text;
    RETURN;
  END IF;

  IF v_status = 'insufficient' OR v_consumed_count = 0 THEN
    RETURN QUERY SELECT false, 0, v_header_id, 'nothing_to_refund'::text;
    RETURN;
  END IF;

  v_to_refund := v_consumed_count - v_already_refunded;
  IF v_to_refund <= 0 THEN
    RETURN QUERY SELECT false, 0, v_header_id, 'already_refunded'::text;
    RETURN;
  END IF;

  UPDATE gold_key_ledger
  SET consumed = false, consumed_at = NULL, consumed_by_play_session_id = NULL
  WHERE consumed_by_play_session_id = p_play_session_id AND consumed = true;

  UPDATE gold_key_consumptions
  SET refunded_count = consumed_count, status = 'refunded', updated_at = now()
  WHERE id = v_header_id;

  RETURN QUERY SELECT true, v_to_refund, v_header_id, 'ok'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.refund_gold_keys(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refund_gold_keys(UUID) TO service_role;

-- ================================================================
-- 6. RLS
-- ================================================================
ALTER TABLE gold_key_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE k_play_sessions       ENABLE ROW LEVEL SECURITY;

-- gold_key_ledger의 기존 "gold_key_ledger_select"(가족 전원 SELECT 허용) 정책을 부모 전용으로 강화한다.
-- 근거: 이 테이블을 다루는 모든 애플리케이션 코드(질문 엔진 RPC 2종, lib/goldkey/ledger.ts 5개 함수,
-- app/api/goldkey/* 3개 라우트)가 예외 없이 service_role만 사용하므로 이 SELECT 정책은 현재 어떤 코드
-- 경로에서도 실사용되지 않는다 — 정책을 좁혀도 회귀 없음.
DROP POLICY IF EXISTS "gold_key_ledger_select" ON gold_key_ledger;
CREATE POLICY "gold_key_ledger_select_parent_only"
  ON gold_key_ledger FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = gold_key_ledger.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );
-- gold_key_ledger_write(service_role 전용)는 기존 그대로 유지, 재생성하지 않는다.

CREATE POLICY "gold_key_consumptions_select_parent_only"
  ON gold_key_consumptions FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = gold_key_consumptions.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );
CREATE POLICY "gold_key_consumptions_write_service_only"
  ON gold_key_consumptions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "k_play_sessions_select_parent_only"
  ON k_play_sessions FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = k_play_sessions.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );
CREATE POLICY "k_play_sessions_write_service_only"
  ON k_play_sessions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
