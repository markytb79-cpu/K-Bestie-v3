-- DRAFT: 실행 전 사용자 승인 필요, 아직 미적용
-- 목적: 20260718100000_goldkey_ky_play_system_v2.sql 에 대한 롤백

DROP POLICY IF EXISTS "k_play_sessions_write_service_only" ON k_play_sessions;
DROP POLICY IF EXISTS "k_play_sessions_select_parent_only" ON k_play_sessions;
DROP POLICY IF EXISTS "gold_key_consumptions_write_service_only" ON gold_key_consumptions;
DROP POLICY IF EXISTS "gold_key_consumptions_select_parent_only" ON gold_key_consumptions;

DROP POLICY IF EXISTS "gold_key_ledger_select_parent_only" ON gold_key_ledger;
CREATE POLICY "gold_key_ledger_select"
  ON gold_key_ledger FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = gold_key_ledger.child_id AND fm.user_id = auth.uid()
    )
  );

DROP FUNCTION IF EXISTS public.refund_gold_keys(UUID);
DROP FUNCTION IF EXISTS public.consume_gold_keys(UUID, INTEGER, TEXT, UUID);
DROP FUNCTION IF EXISTS public.expire_stale_k_sessions();
DROP TRIGGER IF EXISTS trg_k_play_sessions_updated_at ON k_play_sessions;
DROP FUNCTION IF EXISTS public.set_k_play_sessions_updated_at();

ALTER TABLE gold_key_consumptions DROP CONSTRAINT IF EXISTS gold_key_consumptions_play_session_fk;
ALTER TABLE gold_key_ledger DROP CONSTRAINT IF EXISTS gold_key_ledger_consumed_by_play_session_fk;

DROP TABLE IF EXISTS gold_key_consumptions;
DROP TABLE IF EXISTS k_play_sessions;

ALTER TABLE gold_key_ledger DROP COLUMN IF EXISTS consumed_by_play_session_id;
