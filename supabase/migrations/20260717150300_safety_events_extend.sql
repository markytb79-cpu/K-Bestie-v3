-- DRAFT: 실행 전 사용자 승인 필요, 아직 미적용
-- 목적: '질문·대화 엔진'의 안전 이벤트를 추적하기 위해 기존 safety_events 테이블 확장 (PR1)

-- 1. safety_events 테이블에 컬럼 추가
--    child_text 컬럼은 절대 수정하거나 nullable로 바꾸지 않고 그대로 유지함 (확정 결정).
ALTER TABLE safety_events
  ADD COLUMN source TEXT DEFAULT NULL,
  ADD COLUMN child_id UUID REFERENCES child_profiles(id) ON DELETE SET NULL,
  ADD COLUMN question_history_id UUID REFERENCES mission_question_history(id) ON DELETE SET NULL,
  ADD COLUMN event_stage TEXT DEFAULT NULL,
  ADD COLUMN policy_version TEXT DEFAULT NULL;

CREATE INDEX idx_safety_events_child ON safety_events (child_id);

-- 2. safety_events RLS 정책 재정의 (PR1)
--    일반 authenticated 사용자(부모, 자녀, 형제자매 포함)는 접근 차단.
--    ADMIN 역할 사용자 및 service_role만 SELECT 허용.
--    REVIEWER는 차단 (안전 이벤트는 질문은행 검토와 무관하므로).

DROP POLICY IF EXISTS "safety_events_select" ON safety_events;
DROP POLICY IF EXISTS "safety_events_insert" ON safety_events;
DROP POLICY IF EXISTS "safety_events_update" ON safety_events;

-- SELECT 정책: service_role 이거나, 관리자(role = 'ADMIN')인 경우만 허용
CREATE POLICY "safety_events_select"
  ON safety_events FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR get_admin_role(auth.uid()) = 'ADMIN'
  );

-- INSERT 정책: service_role 전용
CREATE POLICY "safety_events_insert"
  ON safety_events FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- UPDATE 정책: service_role 전용 (기존 그대로)
CREATE POLICY "safety_events_update"
  ON safety_events FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
