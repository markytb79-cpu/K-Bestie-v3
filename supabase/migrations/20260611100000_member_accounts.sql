-- ================================================================
-- member_accounts: 오너가 직접 발급하는 username+password 구성원 계정
-- (배우자·아이 — 소셜 로그인 불가, 아이디+비번만 사용)
-- ================================================================
-- 설계 원칙:
--   username  : 화면에 표시되는 로그인 ID (전역 유일, 사용자에게 노출)
--   email     : 향후 실제 이메일 인증용 (현재 NULL — 베타 미사용)
--   Supabase Auth 내부 email : username@kbestie.local (절대 노출 금지)
--   must_change_password : 첫 로그인 비밀번호 변경 안내 플래그
-- ================================================================

CREATE TABLE IF NOT EXISTS member_accounts (
  id                   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username             TEXT NOT NULL,
  email                TEXT NULL,              -- 향후 실제 이메일 (베타는 NULL)
  display_name         TEXT NOT NULL DEFAULT '',
  family_id            UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  role                 TEXT NOT NULL CHECK (role IN ('parent', 'child')),
  created_by           UUID NOT NULL REFERENCES auth.users(id),
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT member_accounts_username_unique UNIQUE (username)
);

CREATE INDEX IF NOT EXISTS idx_member_accounts_family_id ON member_accounts(family_id);
CREATE INDEX IF NOT EXISTS idx_member_accounts_username  ON member_accounts(username);

-- ── RLS ────────────────────────────────────────────────────────────
ALTER TABLE member_accounts ENABLE ROW LEVEL SECURITY;

-- 자신 + 같은 가족 오너만 조회
CREATE POLICY "member_accounts_select"
  ON member_accounts FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.family_id = member_accounts.family_id
        AND fm.user_id   = auth.uid()
        AND fm.role      = 'owner_parent'
    )
  );

-- 오너 또는 service_role만 생성
CREATE POLICY "member_accounts_insert"
  ON member_accounts FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      created_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM family_members fm
        WHERE fm.family_id = member_accounts.family_id
          AND fm.user_id   = auth.uid()
          AND fm.role      = 'owner_parent'
      )
    )
  );

-- 자신(비밀번호 변경 플래그) 또는 오너(리셋) 또는 service_role
CREATE POLICY "member_accounts_update"
  ON member_accounts FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.family_id = member_accounts.family_id
        AND fm.user_id   = auth.uid()
        AND fm.role      = 'owner_parent'
    )
  );

-- ── 검증 쿼리 ──────────────────────────────────────────────────────
-- SELECT tablename, policyname FROM pg_policies WHERE tablename = 'member_accounts';
-- SELECT indexname FROM pg_indexes WHERE tablename = 'member_accounts';
