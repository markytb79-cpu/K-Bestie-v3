CREATE TABLE account_management_audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  UUID NOT NULL,
  actor_email    TEXT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('view_account', 'reset_password')),
  child_id       UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  family_id      UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_account_mgmt_audit_child ON account_management_audit_log (child_id, created_at DESC);
CREATE INDEX idx_account_mgmt_audit_actor ON account_management_audit_log (actor_user_id, created_at DESC);

ALTER TABLE account_management_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_mgmt_audit_service_all"
  ON account_management_audit_log FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 본인이 오너인 가족의 감사로그는 조회 가능(투명성)
CREATE POLICY "account_mgmt_audit_owner_select"
  ON account_management_audit_log FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.family_id = account_management_audit_log.family_id
        AND fm.user_id = auth.uid()
        AND fm.role = 'owner_parent'
    )
  );

GRANT ALL ON public.account_management_audit_log TO anon, authenticated, service_role;
