-- ================================================================
-- family_join_requests 양방향 확장
-- 2026-06-12
-- ================================================================
-- 변경 내용:
--   1. direction 컬럼 추가 (member_request | owner_invite)
--   2. target_user_id 컬럼 추가 (owner_invite 시 초대 대상자)
--   3. 전체 유일 제약 → pending 기준 부분 유일 인덱스로 교체
--   4. RLS SELECT 정책: target_user_id도 자신의 초대 조회 가능하도록 갱신
-- ================================================================

-- ── 1. direction 컬럼 ─────────────────────────────────────────────
ALTER TABLE family_join_requests
  ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'member_request'
    CHECK (direction IN ('member_request', 'owner_invite'));

-- ── 2. target_user_id 컬럼 ───────────────────────────────────────
-- owner_invite 방향: 오너가 초대한 대상(배우자). member_request는 NULL.
ALTER TABLE family_join_requests
  ADD COLUMN IF NOT EXISTS target_user_id UUID REFERENCES auth.users(id);

-- ── 3. 기존 전체 유일 제약 제거 → pending 기준 부분 인덱스로 교체 ─
ALTER TABLE family_join_requests
  DROP CONSTRAINT IF EXISTS family_join_requests_family_id_requester_user_id_key;

-- member_request: 같은 가족에 같은 신청자의 pending이 하나만 존재
CREATE UNIQUE INDEX IF NOT EXISTS idx_fjr_member_req_pending
  ON family_join_requests (family_id, requester_user_id)
  WHERE direction = 'member_request' AND status = 'pending';

-- owner_invite: 같은 가족에서 같은 대상자에 대한 pending 초대가 하나만 존재
CREATE UNIQUE INDEX IF NOT EXISTS idx_fjr_owner_inv_pending
  ON family_join_requests (family_id, target_user_id)
  WHERE direction = 'owner_invite' AND status = 'pending';

-- ── 4. RLS SELECT 정책 갱신 ──────────────────────────────────────
-- target_user_id 본인도 자신의 초대 조회 가능
DROP POLICY IF EXISTS "fjr_select" ON family_join_requests;

CREATE POLICY "fjr_select"
  ON family_join_requests FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR requester_user_id = auth.uid()
    OR target_user_id    = auth.uid()
    OR EXISTS (
      SELECT 1 FROM families f
      WHERE f.id = family_join_requests.family_id
        AND f.created_by = auth.uid()
    )
  );

-- ── 검증 쿼리 ──────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='family_join_requests' ORDER BY ordinal_position;
-- SELECT policyname, cmd FROM pg_policies WHERE tablename='family_join_requests';
-- SELECT indexname FROM pg_indexes WHERE tablename='family_join_requests';
