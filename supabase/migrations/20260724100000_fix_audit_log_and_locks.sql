-- CRITICAL: admin_audit_log.child_id NOT NULL 위반 롤백 방지
ALTER TABLE public.admin_audit_log ALTER COLUMN child_id DROP NOT NULL;

-- HIGH-4: 관리자 승인/거절 RPC에 동시성 락 추가
CREATE OR REPLACE FUNCTION public.admin_approve_account_restore(p_admin_user_id UUID, p_admin_email TEXT, p_target_user_id UUID)
RETURNS TABLE(success BOOLEAN, reason TEXT)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
  v_fam RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('account_restore_' || p_target_user_id::text));

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
  FOR v_fam IN
    SELECT family_id, role FROM public.family_members 
    WHERE user_id = p_target_user_id AND deleted_at IS NOT NULL
  LOOP
    IF v_fam.role = 'owner_parent' THEN
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

CREATE OR REPLACE FUNCTION public.admin_reject_account_restore(p_admin_user_id UUID, p_admin_email TEXT, p_target_user_id UUID, p_reason TEXT)
RETURNS TABLE(success BOOLEAN, reason TEXT)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('account_restore_' || p_target_user_id::text));

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

-- HIGH-3: 파기 시 가족 물리삭제와 auth 계정삭제가 원자적이지 않음
CREATE OR REPLACE FUNCTION public.purge_account_family_data(p_user_id UUID)
RETURNS void
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_family_ids UUID[];
BEGIN
  -- 대상의 purge_batch_id IS NOT NULL 인 가족 찾기
  SELECT array_agg(family_id) INTO v_family_ids
  FROM public.family_members fm
  JOIN public.families f ON f.id = fm.family_id
  WHERE fm.user_id = p_user_id
  AND f.purge_batch_id IS NOT NULL;

  IF v_family_ids IS NOT NULL AND array_length(v_family_ids, 1) > 0 THEN
    -- 물리삭제 (cascade)
    DELETE FROM public.families WHERE id = ANY(v_family_ids);
  END IF;

  -- 부모 계정 상태 변경 및 비식별화
  UPDATE public.parents
  SET account_status = 'PURGED',
      purged_at = now(),
      email = 'purged-' || substring(p_user_id::text from 1 for 8) || '@deleted.local',
      name = 'purged-' || substring(p_user_id::text from 1 for 8)
  WHERE id = p_user_id;

END;
$$ LANGUAGE plpgsql;
REVOKE EXECUTE ON FUNCTION public.purge_account_family_data FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_account_family_data TO service_role;
