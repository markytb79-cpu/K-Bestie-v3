-- ================================================================
-- family_join_requests: 부모의 가족 합류 신청 (신청→오너 승인 방식)
-- 2026-06-12
-- ================================================================
-- 설계 원칙:
--   - 소셜 로그인 부모가 오너 이메일로 특정 가족에 합류 신청
--   - 오너가 앱 내에서 승인/거절 (메일·매직링크 일절 사용 안 함)
--   - 보호자(owner_parent + parent) 최대 2명 제한 — 신청·승인 양시점 방어
--   - parent_invitations(토큰 기반)는 비활성 유지, 이 테이블로 대체
-- ================================================================

CREATE TABLE IF NOT EXISTS family_join_requests (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id         UUID        NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  requester_user_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requester_email   TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by       UUID        REFERENCES auth.users(id),
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_id, requester_user_id)
);

CREATE INDEX IF NOT EXISTS idx_fjr_family_id  ON family_join_requests(family_id);
CREATE INDEX IF NOT EXISTS idx_fjr_requester  ON family_join_requests(requester_user_id);
CREATE INDEX IF NOT EXISTS idx_fjr_status     ON family_join_requests(family_id, status);

-- ── RLS ────────────────────────────────────────────────────────────

ALTER TABLE family_join_requests ENABLE ROW LEVEL SECURITY;

-- 신청자 본인 + 해당 가족 오너만 조회
CREATE POLICY "fjr_select"
  ON family_join_requests FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR requester_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM families f
      WHERE f.id = family_join_requests.family_id
        AND f.created_by = auth.uid()
    )
  );

-- 신청자 본인만 자신의 requester_user_id로 INSERT
CREATE POLICY "fjr_insert"
  ON family_join_requests FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR requester_user_id = auth.uid()
  );

-- 승인·거절은 service_role API 전용 (오너 검증은 API 레이어에서)
CREATE POLICY "fjr_update"
  ON family_join_requests FOR UPDATE
  USING (auth.role() = 'service_role');

-- ── 검증 쿼리 ──────────────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='family_join_requests';
-- SELECT policyname, cmd FROM pg_policies WHERE tablename='family_join_requests';
-- SELECT indexname FROM pg_indexes WHERE tablename='family_join_requests';
