-- ⚠️ 이 파일은 마이그레이션이 아니다 — 파일명이 타임스탬프로 시작하지 않으므로 supabase migration
-- 계열 명령으로 자동 실행되지 않는다. 20260718100000_goldkey_ky_play_system_v2.sql 적용 후 개발/스테이징
-- DB에서 수동으로 실행해 검증하는 용도다. RAISE NOTICE = 통과, RAISE EXCEPTION = 실패로 스크립트가 중단된다.
-- 이 스크립트는 테스트 데이터를 삽입하므로 반드시 개발/스테이징 DB에서만 실행하고, 실행 후 삽입한
-- child_profiles/gold_key_ledger/gold_key_consumptions/k_play_sessions 테스트 행을 정리(DELETE)할 것.

-- ================================================================
-- 섹션 A (스키마 정합성)
-- ================================================================
DO $$
DECLARE
  v_col_count INTEGER;
  v_tbl_count INTEGER;
BEGIN
  -- 1. gold_key_ledger.consumed_by_play_session_id 존재 확인
  SELECT count(*)::INT INTO v_col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'gold_key_ledger'
    AND column_name = 'consumed_by_play_session_id';

  IF v_col_count = 0 THEN
    RAISE EXCEPTION 'gold_key_ledger.consumed_by_play_session_id column does not exist';
  END IF;

  -- 2. gold_key_consumptions 테이블 존재 확인
  SELECT count(*)::INT INTO v_tbl_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'gold_key_consumptions';

  IF v_tbl_count = 0 THEN
    RAISE EXCEPTION 'gold_key_consumptions table does not exist';
  END IF;

  -- 3. k_play_sessions 테이블 존재 확인
  SELECT count(*)::INT INTO v_tbl_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'k_play_sessions';

  IF v_tbl_count = 0 THEN
    RAISE EXCEPTION 'k_play_sessions table does not exist';
  END IF;

  RAISE NOTICE 'Section A (Schema Integrity): PASSED';
END;
$$;

-- ================================================================
-- 섹션 B (22개 상한)
-- ================================================================
DO $$
DECLARE
  v_user_id UUID := gen_random_uuid();
  v_family_id UUID := gen_random_uuid();
  v_child_id UUID := gen_random_uuid();
  v_count INTEGER;
BEGIN
  -- Setup
  INSERT INTO auth.users (id, email) VALUES (v_user_id, 'test_user_b@example.com');
  INSERT INTO families (id, name, created_by) VALUES (v_family_id, 'Test Family B', v_user_id);
  INSERT INTO child_profiles (id, family_id, name, grade) VALUES (v_child_id, v_family_id, 'Test Child B', '1');

  -- 22개 active keys 직접 INSERT
  FOR i IN 1..22 LOOP
    INSERT INTO gold_key_ledger (child_id, reason, expires_at, consumed)
    VALUES (v_child_id, 'attendance', now() + interval '7 days', false);
  END LOOP;

  -- 잔액 조건 쿼리 검증
  SELECT COUNT(*)::INT INTO v_count
  FROM gold_key_ledger
  WHERE child_id = v_child_id AND consumed = false AND expires_at > now();

  IF v_count <> 22 THEN
    RAISE EXCEPTION 'Expected active balance to be 22, but got %', v_count;
  END IF;

  -- Cleanup
  DELETE FROM gold_key_ledger WHERE child_id = v_child_id;
  DELETE FROM child_profiles WHERE id = v_child_id;
  DELETE FROM families WHERE id = v_family_id;
  DELETE FROM auth.users WHERE id = v_user_id;

  RAISE NOTICE 'Section B (22 Max Balance Query): PASSED';
EXCEPTION WHEN OTHERS THEN
  -- Cleanup in case of error
  DELETE FROM gold_key_ledger WHERE child_id = v_child_id;
  DELETE FROM child_profiles WHERE id = v_child_id;
  DELETE FROM families WHERE id = v_family_id;
  DELETE FROM auth.users WHERE id = v_user_id;
  RAISE;
END;
$$;

-- ================================================================
-- 섹션 C (중복 소비/멱등성)
-- ================================================================
DO $$
DECLARE
  v_user_id UUID := gen_random_uuid();
  v_family_id UUID := gen_random_uuid();
  v_child_id UUID := gen_random_uuid();
  v_result RECORD;
  v_balance INTEGER;
  v_header_id UUID;
  v_session_id UUID := gen_random_uuid();
  v_first_header_id UUID;
BEGIN
  -- Setup
  INSERT INTO auth.users (id, email) VALUES (v_user_id, 'test_user_c@example.com');
  INSERT INTO families (id, name, created_by) VALUES (v_family_id, 'Test Family C', v_user_id);
  INSERT INTO child_profiles (id, family_id, name, grade) VALUES (v_child_id, v_family_id, 'Test Child C', '1');

  -- 3개 active keys 준비
  FOR i IN 1..3 LOOP
    INSERT INTO gold_key_ledger (child_id, reason, expires_at, consumed)
    VALUES (v_child_id, 'attendance', now() + interval '7 days', false);
  END LOOP;

  -- 1차 호출: 2개 소비
  SELECT * INTO v_result FROM public.consume_gold_keys(v_child_id, 2, 'test-idem-key-1', NULL);
  IF NOT v_result.success OR v_result.consumed_count <> 2 OR v_result.reason <> 'ok' THEN
    RAISE EXCEPTION 'First consumption failed: success=%, consumed=%, reason=%', 
                    v_result.success, v_result.consumed_count, v_result.reason;
  END IF;
  v_header_id := v_result.header_id;

  -- 잔액 확인 (3 - 2 = 1)
  SELECT COUNT(*)::INT INTO v_balance FROM gold_key_ledger
  WHERE child_id = v_child_id AND consumed = false AND expires_at > now();
  IF v_balance <> 1 THEN
    RAISE EXCEPTION 'Expected balance to be 1, but got %', v_balance;
  END IF;

  -- 2차 호출: 동일 멱등키
  SELECT * INTO v_result FROM public.consume_gold_keys(v_child_id, 2, 'test-idem-key-1', NULL);
  IF NOT v_result.success OR v_result.consumed_count <> 2 OR v_result.reason <> 'already_processed' OR v_result.header_id <> v_header_id THEN
    RAISE EXCEPTION 'Idempotency check failed: success=%, consumed=%, reason=%, header_id=%',
                    v_result.success, v_result.consumed_count, v_result.reason, v_result.header_id;
  END IF;

  -- 잔액 확인 (여전히 1이어야 함)
  SELECT COUNT(*)::INT INTO v_balance FROM gold_key_ledger
  WHERE child_id = v_child_id AND consumed = false AND expires_at > now();
  IF v_balance <> 1 THEN
    RAISE EXCEPTION 'Expected balance to remain 1, but got %', v_balance;
  END IF;

  -- 3차 호출: 서로 다른 멱등키로 동일 play_session_id 중복 소비 시도 검증 (새 세션 생성)
  -- Setup: active keys 2개 추가 (기존 잔액 1 + 2 = 총 3개)
  FOR i IN 1..2 LOOP
    INSERT INTO gold_key_ledger (child_id, reason, expires_at, consumed)
    VALUES (v_child_id, 'attendance', now() + interval '7 days', false);
  END LOOP;

  -- k_play_sessions에 새 세션 1개 INSERT
  INSERT INTO k_play_sessions (id, child_id, play_type, keys_cost, status, expires_at)
  VALUES (v_session_id, v_child_id, 'comic_book', 2, 'in_progress', now() + interval '6 hours');

  -- 1차 호출 (새 멱등키 'test-idem-key-play-1'로 2개 소비)
  SELECT * INTO v_result FROM public.consume_gold_keys(v_child_id, 2, 'test-idem-key-play-1', v_session_id);
  IF NOT v_result.success OR v_result.consumed_count <> 2 OR v_result.reason <> 'ok' THEN
    RAISE EXCEPTION 'First consumption for play session failed: success=%, consumed=%, reason=%', 
                    v_result.success, v_result.consumed_count, v_result.reason;
  END IF;
  v_first_header_id := v_result.header_id;

  -- 잔액 확인 (3 - 2 = 1)
  SELECT COUNT(*)::INT INTO v_balance FROM gold_key_ledger
  WHERE child_id = v_child_id AND consumed = false AND expires_at > now();
  IF v_balance <> 1 THEN
    RAISE EXCEPTION 'Expected balance to be 1 after first session consumption, but got %', v_balance;
  END IF;

  -- 2차 호출 (다른 멱등키 'test-idem-key-play-2'로 동일 play_session_id 2개 소비 시도)
  SELECT * INTO v_result FROM public.consume_gold_keys(v_child_id, 2, 'test-idem-key-play-2', v_session_id);
  IF NOT v_result.success OR v_result.consumed_count <> 2 OR v_result.reason <> 'already_processed' OR v_result.header_id <> v_first_header_id THEN
    RAISE EXCEPTION 'Session idempotency check failed: success=%, consumed=%, reason=%, header_id=%',
                    v_result.success, v_result.consumed_count, v_result.reason, v_result.header_id;
  END IF;

  -- 잔액 확인 (여전히 1이어야 함, 추가 차감 안 됨 확인)
  SELECT COUNT(*)::INT INTO v_balance FROM gold_key_ledger
  WHERE child_id = v_child_id AND consumed = false AND expires_at > now();
  IF v_balance <> 1 THEN
    RAISE EXCEPTION 'Expected balance to remain 1 after blocked second session consumption, but got %', v_balance;
  END IF;

  -- Cleanup
  DELETE FROM gold_key_ledger WHERE child_id = v_child_id;
  DELETE FROM gold_key_consumptions WHERE child_id = v_child_id;
  DELETE FROM k_play_sessions WHERE child_id = v_child_id;
  DELETE FROM child_profiles WHERE id = v_child_id;
  DELETE FROM families WHERE id = v_family_id;
  DELETE FROM auth.users WHERE id = v_user_id;

  RAISE NOTICE 'Section C (Duplicate Consumption / Idempotency): PASSED';
EXCEPTION WHEN OTHERS THEN
  DELETE FROM gold_key_ledger WHERE child_id = v_child_id;
  DELETE FROM gold_key_consumptions WHERE child_id = v_child_id;
  DELETE FROM k_play_sessions WHERE child_id = v_child_id;
  DELETE FROM child_profiles WHERE id = v_child_id;
  DELETE FROM families WHERE id = v_family_id;
  DELETE FROM auth.users WHERE id = v_user_id;
  RAISE;
END;
$$;

-- ================================================================
-- 섹션 D (잔액 부족)
-- ================================================================
DO $$
DECLARE
  v_user_id UUID := gen_random_uuid();
  v_family_id UUID := gen_random_uuid();
  v_child_id UUID := gen_random_uuid();
  v_result RECORD;
  v_unconsumed_count INTEGER;
BEGIN
  -- Setup
  INSERT INTO auth.users (id, email) VALUES (v_user_id, 'test_user_d@example.com');
  INSERT INTO families (id, name, created_by) VALUES (v_family_id, 'Test Family D', v_user_id);
  INSERT INTO child_profiles (id, family_id, name, grade) VALUES (v_child_id, v_family_id, 'Test Child D', '1');

  -- 1개 active key
  INSERT INTO gold_key_ledger (child_id, reason, expires_at, consumed)
  VALUES (v_child_id, 'attendance', now() + interval '7 days', false);

  -- 5개 소비 시도 (잔액 부족해야 함)
  SELECT * INTO v_result FROM public.consume_gold_keys(v_child_id, 5, 'test-idem-key-2', NULL);
  IF v_result.success OR v_result.consumed_count <> 0 OR v_result.reason <> 'insufficient_balance' THEN
    RAISE EXCEPTION 'Expected insufficient_balance, but got: success=%, consumed=%, reason=%',
                    v_result.success, v_result.consumed_count, v_result.reason;
  END IF;

  -- 1개 행이 여전히 consumed = false 인지 확인 (all-or-nothing)
  SELECT COUNT(*)::INT INTO v_unconsumed_count FROM gold_key_ledger
  WHERE child_id = v_child_id AND consumed = false;
  IF v_unconsumed_count <> 1 THEN
    RAISE EXCEPTION 'Expected 1 unconsumed key, but got %', v_unconsumed_count;
  END IF;

  -- Cleanup
  DELETE FROM gold_key_ledger WHERE child_id = v_child_id;
  DELETE FROM gold_key_consumptions WHERE child_id = v_child_id;
  DELETE FROM child_profiles WHERE id = v_child_id;
  DELETE FROM families WHERE id = v_family_id;
  DELETE FROM auth.users WHERE id = v_user_id;

  RAISE NOTICE 'Section D (Insufficient Balance / All-or-Nothing): PASSED';
EXCEPTION WHEN OTHERS THEN
  DELETE FROM gold_key_ledger WHERE child_id = v_child_id;
  DELETE FROM gold_key_consumptions WHERE child_id = v_child_id;
  DELETE FROM child_profiles WHERE id = v_child_id;
  DELETE FROM families WHERE id = v_family_id;
  DELETE FROM auth.users WHERE id = v_user_id;
  RAISE;
END;
$$;

-- ================================================================
-- 섹션 E (환불 멱등성)
-- ================================================================
DO $$
DECLARE
  v_user_id UUID := gen_random_uuid();
  v_family_id UUID := gen_random_uuid();
  v_child_id UUID := gen_random_uuid();
  v_session_id UUID := gen_random_uuid();
  v_result RECORD;
  v_refund_result RECORD;
  v_balance INTEGER;
BEGIN
  -- Setup
  INSERT INTO auth.users (id, email) VALUES (v_user_id, 'test_user_e@example.com');
  INSERT INTO families (id, name, created_by) VALUES (v_family_id, 'Test Family E', v_user_id);
  INSERT INTO child_profiles (id, family_id, name, grade) VALUES (v_child_id, v_family_id, 'Test Child E', '1');

  -- k_play_sessions 생성
  INSERT INTO k_play_sessions (id, child_id, play_type, keys_cost, status, expires_at)
  VALUES (v_session_id, v_child_id, 'comic_book', 2, 'in_progress', now() + interval '6 hours');

  -- 2개 active keys 준비
  FOR i IN 1..2 LOOP
    INSERT INTO gold_key_ledger (child_id, reason, expires_at, consumed)
    VALUES (v_child_id, 'attendance', now() + interval '7 days', false);
  END LOOP;

  -- consume_gold_keys 호출
  SELECT * INTO v_result FROM public.consume_gold_keys(v_child_id, 2, 'test-idem-key-3', v_session_id);
  IF NOT v_result.success OR v_result.consumed_count <> 2 OR v_result.reason <> 'ok' THEN
    RAISE EXCEPTION 'Consumption for play session failed: success=%, consumed=%, reason=%',
                    v_result.success, v_result.consumed_count, v_result.reason;
  END IF;

  -- 잔액 0 확인
  SELECT COUNT(*)::INT INTO v_balance FROM gold_key_ledger
  WHERE child_id = v_child_id AND consumed = false;
  IF v_balance <> 0 THEN
    RAISE EXCEPTION 'Expected balance to be 0 after consumption, but got %', v_balance;
  END IF;

  -- 1차 환불 호출
  SELECT * INTO v_refund_result FROM public.refund_gold_keys(v_session_id);
  IF NOT v_refund_result.success OR v_refund_result.refunded_count <> 2 OR v_refund_result.reason <> 'ok' THEN
    RAISE EXCEPTION 'Refund failed: success=%, refunded=%, reason=%',
                    v_refund_result.success, v_refund_result.refunded_count, v_refund_result.reason;
  END IF;

  -- 2개 행이 다시 consumed = false 인지 확인
  SELECT COUNT(*)::INT INTO v_balance FROM gold_key_ledger
  WHERE child_id = v_child_id AND consumed = false;
  IF v_balance <> 2 THEN
    RAISE EXCEPTION 'Expected balance to be restored to 2, but got %', v_balance;
  END IF;

  -- 2차 환불 호출 (멱등성 / 중복 환불 방지 검증)
  SELECT * INTO v_refund_result FROM public.refund_gold_keys(v_session_id);
  IF v_refund_result.success OR v_refund_result.refunded_count <> 0 OR v_refund_result.reason <> 'already_refunded' THEN
    RAISE EXCEPTION 'Second refund check failed: success=%, refunded=%, reason=%',
                    v_refund_result.success, v_refund_result.refunded_count, v_refund_result.reason;
  END IF;

  -- Cleanup
  DELETE FROM gold_key_ledger WHERE child_id = v_child_id;
  DELETE FROM gold_key_consumptions WHERE child_id = v_child_id;
  DELETE FROM k_play_sessions WHERE id = v_session_id;
  DELETE FROM child_profiles WHERE id = v_child_id;
  DELETE FROM families WHERE id = v_family_id;
  DELETE FROM auth.users WHERE id = v_user_id;

  RAISE NOTICE 'Section E (Refund Idempotency / Double Refund Prevention): PASSED';
EXCEPTION WHEN OTHERS THEN
  DELETE FROM gold_key_ledger WHERE child_id = v_child_id;
  DELETE FROM gold_key_consumptions WHERE child_id = v_child_id;
  DELETE FROM k_play_sessions WHERE id = v_session_id;
  DELETE FROM child_profiles WHERE id = v_child_id;
  DELETE FROM families WHERE id = v_family_id;
  DELETE FROM auth.users WHERE id = v_user_id;
  RAISE;
END;
$$;

-- ================================================================
-- 섹션 F (질문 엔진 미션 보상 회귀 — 프로즈 절차, SQL 어서션 아님)
-- ================================================================
-- 1. record_v2_mission_answer RPC의 잔액 카운트 쿼리(WHERE consumed=false AND expires_at>now())가
--    이번 마이그레이션이 추가한 consumed_by_play_session_id 컬럼과 무관하게 그대로 동작하는지 확인
--    (WHERE절에 해당 컬럼이 없으므로 값에 관계없이 카운트됨 — KY가 소비한 키도 정상적으로 잔액에서
--    빠져야 "공유 지갑" 설계 의도와 일치).
-- 2. (child_id, mission_id, reward_type) 부분 유니크 인덱스(uidx_gold_key_ledger_mission_reward)가
--    이번 마이그레이션으로 재생성/변경되지 않았는지 \d gold_key_ledger 로 확인.
-- 3. reason CHECK 제약이 ('attendance','mission') 그대로인지(이번 마이그레이션이 손대지 않았음을
--    \d gold_key_ledger 로 재확인).
-- 4. 질문 엔진 5-6라운드 집중 리뷰가 검증한 시나리오(22개 상한, 일일 한도, mission_id+reward_type
--    멱등성)를 이번 마이그레이션 적용 후 최소 1회 재실행 권장(전체 3-way 리뷰 재실행은 불필요 — 이
--    마이그레이션이 record_v2_mission_answer/record_v2_safety_pause 함수 본문이나 gold_key_ledger의
--    기존 컬럼·제약을 전혀 수정하지 않으므로).

-- ================================================================
-- 섹션 G (동시성 — 프로즈 절차, 단일 세션 스크립트로 자동화 불가능)
-- ================================================================
-- 1. 두 개의 별도 psql 세션을 연다.
-- 2. 세션1에서 BEGIN; 후 SELECT pg_advisory_xact_lock(hashtext('<테스트-child-id>'));까지만 실행하고
--    COMMIT하지 않은 채 대기한다.
-- 3. 세션2에서 동일 child_id로 consume_gold_keys(...) 또는 record_v2_mission_answer(...)를 호출하면
--    세션1이 COMMIT/ROLLBACK할 때까지 세션2가 블록되는지 확인한다(같은 advisory lock 키를 공유하므로
--    지급·소비·환불이 서로 직렬화됨을 확인하는 것이 목적).
-- 4. 세션1에서 COMMIT하면 세션2가 즉시 이어서 실행되는지 확인한다.

-- ================================================================
-- 섹션 H (롤백 왕복 — 프로즈 절차)
-- ================================================================
-- 1. 개발 DB에서 20260718100000을 적용
-- 2. 위 섹션 A~E 통과 확인
-- 3. rollback/20260718100000_goldkey_ky_play_system_v2_rollback.sql 적용
-- 4. gold_key_ledger에 consumed_by_play_session_id 컬럼이 없고 gold_key_consumptions/k_play_sessions
--    테이블이 없는지 확인
-- 5. 20260718100000을 다시 적용해 정상적으로 재생성되는지 확인(멱등적 재적용 가능해야 함 — 단,
--    CREATE TABLE은 IF NOT EXISTS가 아니므로 완전한 재적용 테스트를 위해서는 그 사이 테스트 데이터가
--    깨끗이 정리되어 있어야 함).
