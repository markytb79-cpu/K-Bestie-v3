-- 초안 (DDL DRAFT ONLY) — 실행 금지, 대표 승인 후 대표가 직접 실행할 것
-- 목적: 황금열쇠 원장 + KY 놀이(만화책/퀴즈/헤어스타일/MBTI) 세션 스키마.
-- K앱과 KY앱이 같은 Supabase 프로젝트를 공유하므로, 모든 신규 테이블은 서비스 롤 전용 쓰기 +
-- "아이 본인과 연결된 부모(owner_parent/parent)"만 SELECT 가능한 RLS로 잠근다.
-- 아이 계정(role='child') JWT로는 이 테이블들을 직접 못 읽는다 — KY 앱 프런트는 반드시
-- 백엔드(Next.js API 등, service_role)를 거쳐서만 잔액/세션 상태를 받아간다.
--
-- ⚠️ 기존 초안 `20260711200000_gold_key_ledger.sql`과의 관계:
--   기존 스키마는 적립 1건 = 1개 열쇠(row 1개당 정확히 1개, consumed boolean)라
--   "적립 건별 잔여수량" 요구사항을 만족하지 못하고, reason도 'attendance'/'mission' 2종류뿐이라
--   미션1/미션2를 구분하지 못한다. 이번 설계는 그 테이블을 quantity/remaining_quantity 기반으로
--   재설계한 것이다. 만약 기존 gold_key_ledger가 이미 실제 DB에 생성되어 있다면(대표 확인 필요),
--   이 파일을 그대로 실행하지 말고 ALTER 마이그레이션으로 다시 설계해야 한다 — 이번 파일은
--   "새 프로젝트/아직 미실행" 전제의 CREATE 초안이다.

-- ================================================================
-- 1. gold_key_ledger — 적립 건별 원장 (잔여수량 방식)
-- ================================================================
-- 적립 규칙: 하루 최대 3개 = 출석 1개(하루 1회) + 미션1 1개 + 미션2 1개
-- 만료: earned_at + 7일(만 7일) — expires_at은 insert 시점에 애플리케이션/트리거가 계산해 고정.
-- 유효잔액 = SUM(remaining_quantity) WHERE expires_at > now()
-- 차감(소비)은 만료 임박(expires_at 오름차순) 순으로 우선 처리 — 아래 2번 함수 참고.

CREATE TABLE gold_key_ledger (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id            UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  reason              TEXT NOT NULL CHECK (reason IN ('attendance', 'mission1', 'mission2')),
  quantity            INTEGER NOT NULL CHECK (quantity > 0),
  remaining_quantity  INTEGER NOT NULL CHECK (remaining_quantity >= 0),
  earned_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (remaining_quantity <= quantity)
);

-- FIFO 스캔 최적화 — child별 "아직 남아있는" 행만 만료순으로
CREATE INDEX idx_gold_key_ledger_fifo
  ON gold_key_ledger (child_id, expires_at)
  WHERE remaining_quantity > 0;

-- 일일 적립 한도 판정(출석 중복/미션1·미션2 각 1회) 조회용
CREATE INDEX idx_gold_key_ledger_earned
  ON gold_key_ledger (child_id, reason, earned_at);

-- ================================================================
-- 2. gold_key_consumptions — 소비 내역(원장 행 ↔ 놀이세션 매핑, 환불용)
-- ================================================================
-- 소비 1건이 여러 원장 행에 걸쳐 나뉠 수 있으므로(FIFO로 여러 건에서 조금씩 차감),
-- "어느 세션이 어느 원장 행에서 몇 개를 가져갔는지"를 남겨야 정확한 환불이 가능하다.
-- 환불은 "소비 이전 상태로 복원"이 목적이므로 새 원장 행을 만들지 않고 원래 행의
-- remaining_quantity를 그대로 되돌린다(환불로 만료기한이 늘어나거나 하는 부작용 없음).

CREATE TABLE gold_key_consumptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  play_session_id UUID NOT NULL, -- FK는 3번 테이블 생성 후 아래에서 추가
  ledger_id       UUID NOT NULL REFERENCES gold_key_ledger(id) ON DELETE RESTRICT,
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  consumed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  refunded_at     TIMESTAMPTZ
);

CREATE INDEX idx_gold_key_consumptions_session ON gold_key_consumptions(play_session_id);
CREATE INDEX idx_gold_key_consumptions_ledger  ON gold_key_consumptions(ledger_id);

-- ================================================================
-- 3. k_play_sessions — KY 놀이 세션 (진행상태 JSON 저장, 6시간 토큰)
-- ================================================================
-- play_type별 소모 열쇠 고정값(요구사항): 만화책=2, 퀴즈=2, 헤어스타일=3, MBTI=3.
-- keys_cost를 세션에 그대로 저장해두는 이유: 나중에 단가가 바뀌어도 과거 세션의
-- "그때 실제로 소모한 개수"가 왜곡되지 않게 하기 위함(부모 리포트 정확성).
-- CHECK로 play_type↔keys_cost 조합을 DB 레벨에서도 강제해 앱 버그로 잘못된 값이
-- 들어가는 것을 막는다(2차 방어선).
--
-- 진행상태(progress_state, JSONB)는 놀이 종류별로 자유 형식이다. 예시:
--   comic_book: {"current_page": 3, "total_pages": 12}
--   quiz:       {"current_question": 2, "answers": {"q1": "A", "q2": "C"}}
--   mbti:       {"current_question": 5, "selections": {"q1": "E", "q2": "N"}}
--   hairstyle:  {"current_step": 2, "selections": {"style": "...", "color": "..."}}
--
-- 상태 전이: in_progress → completed(정상 완료) | expired(6시간 경과, 미완료) | refunded(진입 실패 등으로 열쇠 환불)
-- 한 아이당 같은 play_type의 in_progress는 동시에 1개만 허용(그 놀이의 중복 진입/중복 차감 방지) —
-- 아래 부분 유니크 인덱스가 (child_id, play_type) 기준이므로, 서로 다른 놀이(만화책/퀴즈/MBTI/헤어스타일)는
-- 6시간 토큰 유효기간 안에 각각 동시에 in_progress 상태로 존재하며 각자 이어하기할 수 있다.

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
  expires_at      TIMESTAMPTZ NOT NULL, -- started_at + interval '6 hours' (insert 시 계산)
  completed_at    TIMESTAMPTZ,
  progress_state  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE gold_key_consumptions
  ADD CONSTRAINT gold_key_consumptions_play_session_fk
  FOREIGN KEY (play_session_id) REFERENCES k_play_sessions(id) ON DELETE CASCADE;

-- 아이 1명당 "같은 놀이 종류"의 진행중 세션은 동시에 1개만 — 재접속 복원/중복 차감 방지의
-- 핵심 제약. play_type을 키에 포함시켜 서로 다른 놀이는 각각 별도로 in_progress를 가질 수
-- 있게 한다(예: 만화책 진행 중에 퀴즈도 별도로 시작해 각자 이어하기 가능).
CREATE UNIQUE INDEX idx_k_play_sessions_one_active
  ON k_play_sessions (child_id, play_type)
  WHERE status = 'in_progress';

-- 부모 리포트/완료 이력 조회용 — child별 최근 완료 순
CREATE INDEX idx_k_play_sessions_child_completed
  ON k_play_sessions (child_id, completed_at DESC)
  WHERE status = 'completed';

-- 만료 스윕(§6 참고) 대상 조회용
CREATE INDEX idx_k_play_sessions_expiring
  ON k_play_sessions (expires_at)
  WHERE status = 'in_progress';

-- updated_at 자동 갱신 트리거(진행상태 저장 시마다 갱신 — 재접속 판단에 참고용)
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

-- ================================================================
-- 4. 잔액 차감 — 원자적 함수 + 행 잠금(FOR UPDATE)으로 음수 잔액 방지
-- ================================================================
-- 동시성 보장 원리:
--   같은 child_id의 "아직 남은" 원장 행들을 만료 임박순으로 SELECT ... FOR UPDATE 하여
--   잠근 뒤에만 remaining_quantity를 차감한다. 동시에 같은 아이의 소비 요청이 두 번
--   들어와도 두 번째 트랜잭션은 첫 번째가 커밋/롤백될 때까지 그 행들에서 대기하므로
--   같은 열쇠가 이중으로 소비될 수 없다(서로 다른 아이는 행이 겹치지 않아 병렬 처리 무방).
--   필요한 수량을 다 채우지 못하면 RAISE EXCEPTION으로 함수 전체가 롤백된다 — 즉 "일부만
--   차감되고 나머지는 실패"하는 부분 실패가 구조적으로 불가능하다(all-or-nothing).
--   (기존 lib/goldkey/ledger.ts의 consumeKeys()는 SELECT 후 조건부 UPDATE 방식이라, 두 요청이
--   겹치는 행을 나눠 잡으면 한쪽이 "부족"으로 실패하면서도 자기가 잡은 행은 이미 consumed=true로
--   바뀌어버려 열쇠가 소리소문 없이 사라지는 결함이 있었다 — 이번 설계는 그 결함을 구조적으로 막는다.)

CREATE OR REPLACE FUNCTION public.consume_gold_keys(
  p_child_id UUID,
  p_amount INTEGER,
  p_play_session_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_remaining_needed INTEGER := p_amount;
  v_take INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;

  FOR v_row IN
    SELECT id, remaining_quantity
    FROM gold_key_ledger
    WHERE child_id = p_child_id
      AND remaining_quantity > 0
      AND expires_at > now()
    ORDER BY expires_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining_needed <= 0;
    v_take := LEAST(v_row.remaining_quantity, v_remaining_needed);

    UPDATE gold_key_ledger
    SET remaining_quantity = remaining_quantity - v_take
    WHERE id = v_row.id;

    INSERT INTO gold_key_consumptions (play_session_id, ledger_id, quantity)
    VALUES (p_play_session_id, v_row.id, v_take);

    v_remaining_needed := v_remaining_needed - v_take;
  END LOOP;

  IF v_remaining_needed > 0 THEN
    -- 잔액 부족 — 위에서 실행한 UPDATE/INSERT를 포함해 함수 전체가 롤백된다.
    RAISE EXCEPTION 'insufficient_balance';
  END IF;

  RETURN TRUE;
END;
$$;

-- 환불 — "소비 이전으로 복원". 새 원장 행을 만들지 않고 원래 행에 되돌린다.
-- refunded_at IS NULL 조건으로 중복 환불(같은 세션을 두 번 환불)을 방지한다.
CREATE OR REPLACE FUNCTION public.refund_gold_keys(
  p_play_session_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE gold_key_ledger gl
  SET remaining_quantity = gl.remaining_quantity + gc.quantity
  FROM gold_key_consumptions gc
  WHERE gc.ledger_id = gl.id
    AND gc.play_session_id = p_play_session_id
    AND gc.refunded_at IS NULL;

  UPDATE gold_key_consumptions
  SET refunded_at = now()
  WHERE play_session_id = p_play_session_id
    AND refunded_at IS NULL;
END;
$$;

-- 만료 스윕 — in_progress인데 expires_at이 지난 세션을 일괄 expired로 전환.
-- 굳이 크론이 없어도 "조회 시점에 expires_at<=now()면 expired로 취급"하는 지연 평가만으로도
-- 정합성은 보장되지만(§6 로직 참고), 부모 리포트/집계 정확도를 위해 주기적 스윕을 곁들이는 것을 권장.
-- (크론 등록은 이번 범위 밖 — 등록하지 않음.)
CREATE OR REPLACE FUNCTION public.expire_stale_k_sessions()
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH updated AS (
    UPDATE k_play_sessions
    SET status = 'expired'
    WHERE status = 'in_progress' AND expires_at <= now()
    RETURNING id
  )
  SELECT count(*)::INTEGER FROM updated;
$$;

-- ================================================================
-- 5. RLS — service_role 전체 접근, "아이 본인과 연결된 부모(owner_parent/parent)"만 SELECT
--    아이(role='child') 계정 JWT로는 이 세 테이블을 직접 못 읽는다(KY 앱은 반드시
--    backend API를 거쳐 service_role로 조회/기록해야 함).
-- ================================================================

ALTER TABLE gold_key_ledger      ENABLE ROW LEVEL SECURITY;
ALTER TABLE gold_key_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE k_play_sessions      ENABLE ROW LEVEL SECURITY;

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

CREATE POLICY "gold_key_ledger_write_service_only"
  ON gold_key_ledger FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "gold_key_consumptions_select_parent_only"
  ON gold_key_consumptions FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM k_play_sessions ps
      JOIN child_profiles cp ON cp.id = ps.child_id
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE ps.id = gold_key_consumptions.play_session_id
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

-- ================================================================
-- 6. 6시간 토큰(세션) 처리 로직 — 참고용 의사코드(백엔드 API에서 구현할 흐름)
-- ================================================================
-- KY 놀이 진입 요청(POST /api/ky/play/start 같은 백엔드 엔드포인트, service_role):
--
--   1. SELECT * FROM k_play_sessions
--      WHERE child_id = :childId AND play_type = :playType AND status = 'in_progress'
--      ORDER BY started_at DESC LIMIT 1;
--      (play_type까지 조건에 넣어야 한다 — 아이가 서로 다른 놀이를 동시에 진행 중일 수 있으므로
--      "이 놀이"의 in_progress 세션만 봐야 다른 놀이의 진행상태를 잘못 이어받지 않는다.)
--
--   2. 있고 expires_at > now() 이면:
--        → "재접속 복원" — 열쇠 재차감 없이 그 세션의 progress_state를 그대로 반환.
--
--   3. 있고 expires_at <= now() 이면:
--        → UPDATE k_play_sessions SET status='expired' WHERE id = 그 세션.id;
--        → 3-A로 진행(신규 세션 생성 절차, 새로 열쇠 차감).
--
--   4. 없으면(3-A 포함) — 신규 세션 생성:
--        a. play_type에 대응하는 keys_cost 확정(2 또는 3).
--        b. INSERT INTO k_play_sessions(child_id, play_type, keys_cost, expires_at, ...)
--           VALUES (..., now() + interval '6 hours', ...) RETURNING id;
--        c. SELECT consume_gold_keys(:childId, :keysCost, :새_session_id);
--           - 예외(insufficient_balance) 발생 시: 세션 row도 함께 롤백해야 하므로,
--             b와 c는 반드시 "같은 DB 트랜잭션"(하나의 RPC 함수 또는 하나의 Postgres
--             트랜잭션) 안에서 실행할 것 — 그래야 잔액 부족 시 세션 자체가 아예
--             생성되지 않은 상태로 자동 롤백된다(진입 실패 시 별도 환불 로직 불필요).
--        d. b~c가 같은 트랜잭션에서 이미 커밋된 뒤, 그 다음 단계(예: 외부 에셋 로딩,
--           놀이 초기화 등 DB 밖의 처리)가 실패하는 경우에는 이미 커밋된 소비를 되돌려야
--           하므로 이때만 SELECT refund_gold_keys(:session_id) 호출 후
--           UPDATE k_play_sessions SET status='refunded' WHERE id=:session_id.
--
--   진행 중 저장(POST /api/ky/play/progress):
--     UPDATE k_play_sessions SET progress_state = :json
--     WHERE id = :sessionId AND status = 'in_progress' AND expires_at > now();
--     (0 rows 갱신되면 = 이미 만료된 세션이라는 뜻 → 클라이언트에 "세션 만료" 안내)
--
--   완료(POST /api/ky/play/complete):
--     UPDATE k_play_sessions
--     SET status = 'completed', completed_at = now()
--     WHERE id = :sessionId AND status = 'in_progress' AND expires_at > now();
--
--   부모 리포트가 읽는 "놀이 완료 기록" 쿼리 — 별도 테이블 없이 k_play_sessions 재사용:
--     SELECT play_type, completed_at, (completed_at - started_at) AS duration, keys_cost
--     FROM k_play_sessions
--     WHERE child_id = :childId AND status = 'completed'
--     ORDER BY completed_at DESC;
--     (완료된 세션 row 자체가 영구 보관되는 완료 기록이므로 중복 테이블을 만들지 않았다.)
