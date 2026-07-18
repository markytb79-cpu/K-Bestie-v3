-- 관리자 열람 감사 로그: 누가/언제/어느 아이의 대화 또는 안전이벤트를 열람했는지 기록.
CREATE TABLE admin_audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id  UUID NOT NULL,
  admin_email    TEXT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('view_conversations', 'view_safety_events')),
  child_id       UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_audit_log_child ON admin_audit_log (child_id, created_at DESC);
CREATE INDEX idx_admin_audit_log_admin ON admin_audit_log (admin_user_id, created_at DESC);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_audit_log_service_all"
  ON admin_audit_log FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
