-- DRAFT: 실행 전 사용자 승인 필요, 아직 미적용
-- 목적: 20260717150000_question_engine_schema_extend.sql 에 대한 롤백

-- 1. mission_questions 컬럼 롤백
ALTER TABLE mission_questions
  DROP COLUMN IF EXISTS clinical_status,
  DROP COLUMN IF EXISTS conversation_stage,
  DROP COLUMN IF EXISTS question_intent,
  DROP COLUMN IF EXISTS question_bank_version;

-- 2. mission_question_history 컬럼 롤백
ALTER TABLE mission_question_history
  DROP COLUMN IF EXISTS answer_classification,
  DROP COLUMN IF EXISTS message_ref_id,
  DROP COLUMN IF EXISTS question_role,
  DROP COLUMN IF EXISTS selected_order,
  DROP COLUMN IF EXISTS asked_order,
  DROP COLUMN IF EXISTS follow_up_used,
  DROP COLUMN IF EXISTS progress_awarded;

-- 3. mission_progress 컬럼 롤백
ALTER TABLE mission_progress
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS required_valid_count,
  DROP COLUMN IF EXISTS engine_version;

-- 4. RLS 정책 복원 (20260711100000_mission_question_bank.sql 패턴으로 롤백)
DROP POLICY IF EXISTS "parent_read_mqh" ON mission_question_history;
CREATE POLICY "parent_read_mqh"
  ON mission_question_history FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "parent_read_mission_progress" ON mission_progress;
CREATE POLICY "parent_read_mission_progress"
  ON mission_progress FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');
