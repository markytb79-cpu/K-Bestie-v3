-- 1. parents 테이블 확장
ALTER TABLE public.parents
  ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (account_status IN ('ACTIVE','WITHDRAWN_PENDING','RESTORE_REQUESTED','RESTORED','PURGED')),
  ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purge_scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS restore_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS restored_by UUID,
  ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS withdrawal_reason TEXT;

-- 2. families / family_members 소프트삭제 컬럼
ALTER TABLE public.families 
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, 
  ADD COLUMN IF NOT EXISTS purge_batch_id UUID;

ALTER TABLE public.family_members 
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 가족 작성자(created_by) FK 제약을 ON DELETE SET NULL로 변경 (탈퇴/파기 시 에러 방지)
ALTER TABLE public.families ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.families DROP CONSTRAINT IF EXISTS families_created_by_fkey;
ALTER TABLE public.families ADD CONSTRAINT families_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3. RLS 정책 수정
-- families_select_member
DROP POLICY IF EXISTS "families_select_member" ON public.families;
CREATE POLICY "families_select_member"
  ON public.families FOR SELECT
  USING (
    families.deleted_at IS NULL 
    AND EXISTS (
      SELECT 1 FROM public.family_members fm
      WHERE fm.family_id = families.id 
      AND fm.user_id = auth.uid() 
      AND fm.deleted_at IS NULL
    )
  );

-- child_profiles_select
DROP POLICY IF EXISTS "child_profiles_select" ON public.child_profiles;
CREATE POLICY "child_profiles_select"
  ON public.child_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.family_members fm
      JOIN public.families f ON f.id = fm.family_id
      WHERE fm.family_id = child_profiles.family_id 
      AND fm.user_id = auth.uid() 
      AND fm.deleted_at IS NULL
      AND f.deleted_at IS NULL
    )
  );

-- family_members_select
DROP POLICY IF EXISTS "family_members_select" ON public.family_members;
CREATE POLICY "family_members_select"
  ON public.family_members FOR SELECT
  USING (
    (user_id = auth.uid() AND deleted_at IS NULL)
  );

-- 4. admin_audit_log 확장
ALTER TABLE public.admin_audit_log
  ADD COLUMN IF NOT EXISTS family_id UUID,
  ADD COLUMN IF NOT EXISTS target_user_id UUID,
  ADD COLUMN IF NOT EXISTS reason TEXT;

ALTER TABLE public.admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_action_check;
ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_action_check
  CHECK (action IN ('view_conversations','view_safety_events',
    'account_withdrawal_requested','account_restore_requested',
    'account_restore_approved','account_restore_rejected','account_purged'));

-- 5. RPC 함수들

-- request_account_withdrawal
CREATE OR REPLACE FUNCTION public.request_account_withdrawal(p_user_id UUID, p_reason TEXT, p_successor_user_id UUID DEFAULT NULL)
RETURNS TABLE(success BOOLEAN, reason TEXT)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
  v_fam RECORD;
  v_has_other_parent BOOLEAN;
  v_successor_valid BOOLEAN;
  v_purge_batch_id UUID;
BEGIN
  -- 동시성 제어 (이중 클릭 방지)
  PERFORM pg_advisory_xact_lock(hashtext('account_withdrawal_' || p_user_id::text));

  SELECT account_status INTO v_status FROM public.parents WHERE id = p_user_id;
  IF NOT FOUND OR (v_status != 'ACTIVE' AND v_status != 'RESTORED') THEN
    RETURN QUERY SELECT false, 'invalid_state'::TEXT;
    RETURN;
  END IF;

  FOR v_fam IN 
    SELECT fm.family_id, fm.role 
    FROM public.family_members fm 
    WHERE fm.user_id = p_user_id AND fm.deleted_at IS NULL
  LOOP
    IF v_fam.role = 'owner_parent' THEN
      -- 다른 보호자 있는지 확인
      SELECT EXISTS (
        SELECT 1 FROM public.family_members 
        WHERE family_id = v_fam.family_id 
        AND user_id != p_user_id 
        AND deleted_at IS NULL 
        AND role IN ('owner_parent', 'parent')
      ) INTO v_has_other_parent;

      IF v_has_other_parent THEN
        IF p_successor_user_id IS NULL THEN
          RETURN QUERY SELECT false, 'successor_required'::TEXT;
          RETURN;
        END IF;

        SELECT EXISTS (
          SELECT 1 FROM public.family_members 
          WHERE family_id = v_fam.family_id 
          AND user_id = p_successor_user_id 
          AND deleted_at IS NULL 
          AND role IN ('owner_parent', 'parent')
        ) INTO v_successor_valid;

        IF NOT v_successor_valid THEN
          RETURN QUERY SELECT false, 'successor_required'::TEXT;
          RETURN;
        END IF;

        -- 승계 처리
        UPDATE public.family_members 
        SET role = 'owner_parent' 
        WHERE family_id = v_fam.family_id AND user_id = p_successor_user_id;

        -- created_by 업데이트 (optional but good practice)
        UPDATE public.families
        SET created_by = p_successor_user_id
        WHERE id = v_fam.family_id;

        -- 본인 소프트삭제
        UPDATE public.family_members 
        SET deleted_at = now() 
        WHERE family_id = v_fam.family_id AND user_id = p_user_id;
      ELSE
        -- 단독 오너
        v_purge_batch_id := gen_random_uuid();
        UPDATE public.families 
        SET deleted_at = now(), purge_batch_id = v_purge_batch_id 
        WHERE id = v_fam.family_id;

        UPDATE public.family_members 
        SET deleted_at = now() 
        WHERE family_id = v_fam.family_id;
      END IF;
    ELSE
      -- 일반 보호자나 자녀(자녀는 탈퇴를 못하지만 만약 있다면)
      UPDATE public.family_members 
      SET deleted_at = now() 
      WHERE family_id = v_fam.family_id AND user_id = p_user_id;
    END IF;
  END LOOP;

  -- 계정 상태 업데이트
  UPDATE public.parents 
  SET account_status = 'WITHDRAWN_PENDING', 
      withdrawn_at = now(), 
      purge_scheduled_at = now() + interval '30 days', 
      withdrawal_reason = p_reason 
  WHERE id = p_user_id;

  -- 감사 로그
  INSERT INTO public.admin_audit_log (admin_user_id, admin_email, action, target_user_id, reason)
  VALUES (p_user_id, (SELECT email FROM public.parents WHERE id = p_user_id), 'account_withdrawal_requested', p_user_id, p_reason);

  RETURN QUERY SELECT true, 'ok'::TEXT;
END;
$$ LANGUAGE plpgsql;
REVOKE EXECUTE ON FUNCTION public.request_account_withdrawal FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_withdrawal TO service_role;

-- request_account_restore
CREATE OR REPLACE FUNCTION public.request_account_restore(p_user_id UUID)
RETURNS TABLE(success BOOLEAN, reason TEXT)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
  v_purge_scheduled_at TIMESTAMPTZ;
BEGIN
  SELECT account_status, purge_scheduled_at INTO v_status, v_purge_scheduled_at FROM public.parents WHERE id = p_user_id;
  IF NOT FOUND OR v_status != 'WITHDRAWN_PENDING' THEN
    RETURN QUERY SELECT false, 'invalid_state'::TEXT;
    RETURN;
  END IF;

  IF v_purge_scheduled_at < now() THEN
    RETURN QUERY SELECT false, 'purge_deadline_passed'::TEXT;
    RETURN;
  END IF;

  UPDATE public.parents 
  SET account_status = 'RESTORE_REQUESTED', 
      restore_requested_at = now() 
  WHERE id = p_user_id;

  INSERT INTO public.admin_audit_log (admin_user_id, admin_email, action, target_user_id)
  VALUES (p_user_id, (SELECT email FROM public.parents WHERE id = p_user_id), 'account_restore_requested', p_user_id);

  RETURN QUERY SELECT true, 'ok'::TEXT;
END;
$$ LANGUAGE plpgsql;
REVOKE EXECUTE ON FUNCTION public.request_account_restore FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_restore TO service_role;

-- admin_approve_account_restore
CREATE OR REPLACE FUNCTION public.admin_approve_account_restore(p_admin_user_id UUID, p_admin_email TEXT, p_target_user_id UUID)
RETURNS TABLE(success BOOLEAN, reason TEXT)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
  v_fam RECORD;
BEGIN
  SELECT account_status INTO v_status FROM public.parents WHERE id = p_target_user_id;
  IF NOT FOUND OR v_status != 'RESTORE_REQUESTED' THEN
    RETURN QUERY SELECT false, 'invalid_state'::TEXT;
    RETURN;
  END IF;

  -- 1. 단독 오너 탈퇴로 통째로 내려간 가족 복원
  FOR v_fam IN
    SELECT id, purge_batch_id FROM public.families 
    WHERE purge_batch_id IS NOT NULL AND deleted_at IS NOT NULL
      AND id IN (SELECT family_id FROM public.family_members WHERE user_id = p_target_user_id AND deleted_at IS NOT NULL)
  LOOP
    -- 가족 복원
    UPDATE public.families SET deleted_at = NULL, purge_batch_id = NULL WHERE id = v_fam.id;
    -- 해당 가족의 모든 멤버 복원 (본인 포함)
    UPDATE public.family_members SET deleted_at = NULL WHERE family_id = v_fam.id AND deleted_at IS NOT NULL;
  END LOOP;

  -- 2. 오너 승계 또는 일반 보호자로 탈퇴했던 건 복원 (가족은 살아있음)
  -- 이때 원래 owner_parent 였더라도 승계하고 나갔으면 'parent'로 복원해야 함
  FOR v_fam IN
    SELECT family_id, role FROM public.family_members 
    WHERE user_id = p_target_user_id AND deleted_at IS NOT NULL
  LOOP
    IF v_fam.role = 'owner_parent' THEN
      -- 복원하려는 가족에 이미 owner_parent가 살아있는지 확인
      IF EXISTS (SELECT 1 FROM public.family_members WHERE family_id = v_fam.family_id AND role = 'owner_parent' AND deleted_at IS NULL AND user_id != p_target_user_id) THEN
        UPDATE public.family_members SET role = 'parent', deleted_at = NULL WHERE family_id = v_fam.family_id AND user_id = p_target_user_id;
      ELSE
        UPDATE public.family_members SET deleted_at = NULL WHERE family_id = v_fam.family_id AND user_id = p_target_user_id;
      END IF;
    ELSE
      UPDATE public.family_members SET deleted_at = NULL WHERE family_id = v_fam.family_id AND user_id = p_target_user_id;
    END IF;
  END LOOP;

  UPDATE public.parents 
  SET account_status = 'RESTORED', restored_at = now(), restored_by = p_admin_user_id 
  WHERE id = p_target_user_id;

  INSERT INTO public.admin_audit_log (admin_user_id, admin_email, action, target_user_id)
  VALUES (p_admin_user_id, p_admin_email, 'account_restore_approved', p_target_user_id);

  RETURN QUERY SELECT true, 'ok'::TEXT;
END;
$$ LANGUAGE plpgsql;
REVOKE EXECUTE ON FUNCTION public.admin_approve_account_restore FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_approve_account_restore TO service_role;

-- admin_reject_account_restore
CREATE OR REPLACE FUNCTION public.admin_reject_account_restore(p_admin_user_id UUID, p_admin_email TEXT, p_target_user_id UUID, p_reason TEXT)
RETURNS TABLE(success BOOLEAN, reason TEXT)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT account_status INTO v_status FROM public.parents WHERE id = p_target_user_id;
  IF NOT FOUND OR v_status != 'RESTORE_REQUESTED' THEN
    RETURN QUERY SELECT false, 'invalid_state'::TEXT;
    RETURN;
  END IF;

  UPDATE public.parents 
  SET account_status = 'WITHDRAWN_PENDING', restore_requested_at = NULL 
  WHERE id = p_target_user_id;

  INSERT INTO public.admin_audit_log (admin_user_id, admin_email, action, target_user_id, reason)
  VALUES (p_admin_user_id, p_admin_email, 'account_restore_rejected', p_target_user_id, p_reason);

  RETURN QUERY SELECT true, 'ok'::TEXT;
END;
$$ LANGUAGE plpgsql;
REVOKE EXECUTE ON FUNCTION public.admin_reject_account_restore FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_account_restore TO service_role;

-- revoke_all_sessions
CREATE OR REPLACE FUNCTION public.revoke_all_sessions(p_user_id UUID)
RETURNS void
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;
REVOKE EXECUTE ON FUNCTION public.revoke_all_sessions FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_all_sessions TO service_role;

-- 6. 파기(purge) Cron Job
select cron.schedule(
  'kbestie-account-purge',
  '0 22 * * *',
  $$
    select net.http_post(
      url:='https://app.k-bestie.com/api/batch/account-purge',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer <BATCH_SECRET>"}'::jsonb,
      body:='{}'::jsonb
    );
  $$
);
