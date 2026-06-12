-- ================================================================
-- family_join_requests: status에 'cancelled' 추가
-- 2026-06-12
-- ================================================================
-- 오너가 자신이 보낸 owner_invite를 철회(취소)할 수 있도록
-- CHECK 제약에 'cancelled' 값을 추가.
-- ================================================================

ALTER TABLE family_join_requests
  DROP CONSTRAINT IF EXISTS family_join_requests_status_check;

ALTER TABLE family_join_requests
  ADD CONSTRAINT family_join_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));

-- ── 검증 ────────────────────────────────────────────────────────────
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'family_join_requests'::regclass AND contype = 'c';
