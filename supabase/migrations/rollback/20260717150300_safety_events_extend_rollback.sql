-- DRAFT: 실행 전 사용자 승인 필요, 아직 미적용
-- 목적: 20260717150300_safety_events_extend.sql 에 대한 롤백

ALTER TABLE safety_events
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS child_id,
  DROP COLUMN IF EXISTS question_history_id,
  DROP COLUMN IF EXISTS event_stage,
  DROP COLUMN IF EXISTS policy_version;

-- RLS 복원: 원래 정책(가족 체인 SELECT 허용)으로 복원
DROP POLICY IF EXISTS "safety_events_select" ON safety_events;
DROP POLICY IF EXISTS "safety_events_insert" ON safety_events;
DROP POLICY IF EXISTS "safety_events_update" ON safety_events;

CREATE POLICY "safety_events_select"
  ON safety_events FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM chat_sessions cs
      JOIN child_profiles cp ON cp.id = cs.child_id
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cs.id = safety_events.session_id AND fm.user_id = auth.uid()
    )
  );

CREATE POLICY "safety_events_insert"
  ON safety_events FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "safety_events_update"
  ON safety_events FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
