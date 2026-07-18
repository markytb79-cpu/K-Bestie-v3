-- DRAFT: 실행 전 사용자 승인 필요, 아직 미적용
-- 목적: '질문·대화 엔진' 기능에 맞춘 기존 스키마 확장 (PR1)

-- 1. mission_questions 테이블 확장
ALTER TABLE mission_questions
  ADD COLUMN clinical_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (clinical_status IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'NEEDS_REVISION', 'REJECTED')),
  ADD COLUMN conversation_stage TEXT
    CHECK (conversation_stage IN ('INTEREST', 'DAILY_LIFE', 'EMOTION', 'BRIDGE', 'FOLLOW_UP')),
  ADD COLUMN question_intent TEXT,
  ADD COLUMN question_bank_version TEXT;

-- 2. mission_question_history 테이블 확장
ALTER TABLE mission_question_history
  ADD COLUMN answer_classification TEXT
    CHECK (answer_classification IN ('VALID', 'PARTIAL', 'REFUSAL', 'NO_RESPONSE', 'SAFETY_SIGNAL')),
  ADD COLUMN message_ref_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  ADD COLUMN question_role TEXT
    CHECK (question_role IN ('PRIMARY', 'RESERVE')),
  ADD COLUMN selected_order INT,
  ADD COLUMN asked_order INT,
  ADD COLUMN follow_up_used BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN progress_awarded BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN mission_question_history.answer_status IS '레거시 상태값(answered/skipped/refused). UI 하위호환을 위해 계속 기록되지만 더 이상 진행률 판정의 권위값이 아니다.';
COMMENT ON COLUMN mission_question_history.answer_classification IS '질문 엔진 V2의 최종 판정 source of truth(VALID/PARTIAL/REFUSAL/NO_RESPONSE/SAFETY_SIGNAL). progress_awarded와 함께 서버 진행률 계산의 기준이 된다.';
COMMENT ON COLUMN mission_question_history.progress_awarded IS '이 답변이 실제로 진행률에 반영됐는지 여부(boolean)';

-- 3. mission_progress 테이블 확장
ALTER TABLE mission_progress
  ADD COLUMN status TEXT,
  ADD COLUMN required_valid_count INT NOT NULL DEFAULT 5,
  ADD COLUMN engine_version TEXT;

-- 4. 기존 행에 대한 백필 진행 (기본값 변경으로 기존 행 추가 시 기본값이 자동 적용되므로, UPDATE 문은 중복이라 제거함)

-- 5. RLS 정책 재정의 (교차 가족 및 형제자매 간 데이터 누출 차단)
-- (a) mission_question_history
DROP POLICY IF EXISTS "parent_read_mqh" ON mission_question_history;

CREATE POLICY "parent_read_mqh"
  ON mission_question_history FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = mission_question_history.child_id
        AND fm.user_id = auth.uid()
        AND (
          fm.role IN ('owner_parent', 'parent')
          OR (fm.role = 'child' AND cp.member_id = fm.id)
        )
    )
  );

-- (b) mission_progress
DROP POLICY IF EXISTS "parent_read_mission_progress" ON mission_progress;

CREATE POLICY "parent_read_mission_progress"
  ON mission_progress FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM chat_sessions cs
      JOIN child_profiles cp ON cp.id = cs.child_id
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cs.id = mission_progress.session_id
        AND fm.user_id = auth.uid()
        AND (
          fm.role IN ('owner_parent', 'parent')
          OR (fm.role = 'child' AND cp.member_id = fm.id)
        )
    )
  );

