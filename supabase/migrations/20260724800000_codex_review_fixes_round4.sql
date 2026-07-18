-- supabase/migrations/20260724800000_codex_review_fixes_round4.sql
CREATE OR REPLACE FUNCTION public.admin_approve_account_restore(p_admin_user_id UUID, p_admin_email TEXT, p_target_user_id UUID)
RETURNS TABLE(success BOOLEAN, reason TEXT)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
  v_fam RECORD;
  v_lock RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('account_withdrawal_' || p_target_user_id::text));

  -- Lock families
  FOR v_lock IN SELECT family_id FROM public.family_members WHERE user_id = p_target_user_id AND deleted_at IS NOT NULL ORDER BY family_id LOOP
    PERFORM pg_advisory_xact_lock(hashtext('family_withdrawal_' || v_lock.family_id::text));
  END LOOP;

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
      AND purge_initiated_by = p_target_user_id
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
      AND family_id NOT IN (SELECT id FROM public.families WHERE deleted_at IS NOT NULL)
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

  -- 여전히 삭제 상태로 남은 가족(본인이 파기자가 아니어서 복원되지 않은)에 남아있는 본인의 옛 멤버십 행을 물리 삭제해서
  -- 전역 UNIQUE(user_id) 슬롯을 해제 (그래야 복구된 계정으로 새 가족을 만들거나 가입할 수 있음)
  DELETE FROM public.family_members
  WHERE user_id = p_target_user_id
    AND deleted_at IS NOT NULL
    AND family_id IN (SELECT id FROM public.families WHERE deleted_at IS NOT NULL);

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
