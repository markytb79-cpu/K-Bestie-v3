-- DRAFT: 실행 전 사용자 승인 필요, 아직 미적용
-- 목적: 20260717160000_question_engine_v11_addendum.sql 에 대한 롤백

-- 1. gold_key_ledger의 인덱스 및 컬럼 롤백
DROP INDEX IF EXISTS uidx_gold_key_ledger_mission_reward;

ALTER TABLE gold_key_ledger
  DROP COLUMN IF EXISTS mission_id,
  DROP COLUMN IF EXISTS reward_type;

-- 2. mission_question_history의 컬럼 롤백
ALTER TABLE mission_question_history
  DROP COLUMN IF EXISTS session_id,
  DROP COLUMN IF EXISTS termination_reason;

-- 3. answer_status / answer_classification 컬럼 코멘트 롤백 (20260717150000_question_engine_schema_extend.sql 기준으로 복원)
COMMENT ON COLUMN mission_question_history.answer_status IS '현재 미션 진행 판정의 source of truth (실제 서비스 동작 기준)';
COMMENT ON COLUMN mission_question_history.answer_classification IS '질문 엔진의 분류/감사 목적 값 (PR2에서 진행률 로직이 이 컬럼 소비로 전환되기 전까지는 참고용)';
