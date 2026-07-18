-- 버그 D: families 테이블에 purge_initiated_by 컬럼 추가
ALTER TABLE public.families 
  ADD COLUMN IF NOT EXISTS purge_initiated_by UUID;

-- 버그 A: fn_check_owner_succession_guard Constraint B NULL 비교로 제약 우회 가능 수정
CREATE OR REPLACE FUNCTION public.fn_check_owner_succession_guard()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_family_ids UUID[] := '{}';
  v_user_ids UUID[] := '{}';
  v_fid UUID;
  v_uid UUID;
  v_account_status TEXT;
BEGIN
  -- 수집: 영향받은 family_id, user_id (NEW/OLD 양쪽 고려)
  IF TG_TABLE_NAME = 'families' THEN
    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN v_family_ids := array_append(v_family_ids, OLD.id); END IF;
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN v_family_ids := array_append(v_family_ids, NEW.id); END IF;
  ELSIF TG_TABLE_NAME = 'family_members' THEN
    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN 
      v_family_ids := array_append(v_family_ids, OLD.family_id); 
      v_user_ids := array_append(v_user_ids, OLD.user_id);
    END IF;
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN 
      v_family_ids := array_append(v_family_ids, NEW.family_id); 
      v_user_ids := array_append(v_user_ids, NEW.user_id);
    END IF;
  ELSIF TG_TABLE_NAME = 'parents' THEN
    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN v_user_ids := array_append(v_user_ids, OLD.id); END IF;
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN v_user_ids := array_append(v_user_ids, NEW.id); END IF;
  END IF;

  -- Constraint A: families.deleted_at IS NULL인 가족은 활성 owner_parent가 최소 1명 존재해야 함
  FOR v_fid IN SELECT DISTINCT unnest(v_family_ids) LOOP
    IF EXISTS (SELECT 1 FROM public.families WHERE id = v_fid AND deleted_at IS NULL) THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.family_members fm
        JOIN public.parents p ON p.id = fm.user_id
        WHERE fm.family_id = v_fid
          AND fm.role = 'owner_parent'
          AND fm.deleted_at IS NULL
          AND p.account_status IN ('ACTIVE', 'RESTORED')
      ) THEN
        RAISE EXCEPTION 'Constraint Violation: Active family % must have at least one active owner_parent.', v_fid;
      END IF;
    END IF;
  END LOOP;

  -- Constraint B: family_members.role=''owner_parent'' AND deleted_at IS NULL인 모든 행은 부모가 ACTIVE 또는 RESTORED여야 함
  FOR v_uid IN SELECT DISTINCT unnest(v_user_ids) LOOP
    IF EXISTS (
      SELECT 1 FROM public.family_members fm
      WHERE fm.user_id = v_uid
        AND fm.role = 'owner_parent'
        AND fm.deleted_at IS NULL
    ) THEN
      SELECT account_status INTO v_account_status FROM public.parents WHERE id = v_uid;
      IF v_account_status IS NULL OR v_account_status NOT IN ('ACTIVE', 'RESTORED') THEN
        RAISE EXCEPTION 'Constraint Violation: User % is an active owner_parent but account is not ACTIVE or RESTORED.', v_uid;
      END IF;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 버그 B: families와 family_members INSERT를 하나의 RPC 트랜잭션으로 묶기
CREATE OR REPLACE FUNCTION public.create_family_with_owner(p_user_id UUID, p_name TEXT)
RETURNS TABLE(family_id UUID, family_name TEXT, created_at TIMESTAMPTZ, error_code TEXT)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_family_id UUID;
  v_new_created_at TIMESTAMPTZ;
BEGIN
  -- 1. 이미 다른 가족에 속해있는지 확인
  IF EXISTS (SELECT 1 FROM public.family_members WHERE user_id = p_user_id AND deleted_at IS NULL) THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ, 'already_member'::TEXT;
    RETURN;
  END IF;

  -- 2. families INSERT
  INSERT INTO public.families (name, created_by) 
  VALUES (p_name, p_user_id) 
  RETURNING id, public.families.created_at INTO v_new_family_id, v_new_created_at;

  -- 3. family_members INSERT
  INSERT INTO public.family_members (family_id, user_id, role) 
  VALUES (v_new_family_id, p_user_id, 'owner_parent');

  -- 4. 전부 성공
  RETURN QUERY SELECT v_new_family_id, p_name, v_new_created_at, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.create_family_with_owner FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_family_with_owner TO service_role;

-- 트리거 롤백 및 INSERT 감시 복원 (버그 B 연계)
DROP TRIGGER IF EXISTS trg_owner_succession_guard_families ON public.families;
CREATE CONSTRAINT TRIGGER trg_owner_succession_guard_families
AFTER INSERT OR UPDATE OR DELETE ON public.families
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.fn_check_owner_succession_guard();

-- 버그 C, D, E: request_account_withdrawal
DROP FUNCTION IF EXISTS public.request_account_withdrawal(UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.request_account_withdrawal(
  p_user_id UUID, 
  p_reason TEXT DEFAULT NULL, 
  p_successor_user_id UUID DEFAULT NULL, 
  p_confirmed_last_guardian BOOLEAN DEFAULT false
)
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
  -- 동시성 제어 (이중 클릭 방지, user 락 먼저)
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
    ORDER BY fm.family_id -- 데드락 방지를 위해 순서 보장
  LOOP
    -- 가족 단위 락 (user 락 이후 동일한 순서)
    PERFORM pg_advisory_xact_lock(hashtext('family_withdrawal_' || v_fam.family_id::text));

    IF v_fam.role = 'owner_parent' THEN
      -- 다른 활성 보호자 있는지 확인 (is_active_family_guardian 헬퍼 이용)
      SELECT EXISTS (
        SELECT 1 FROM public.family_members fm2
        WHERE fm2.family_id = v_fam.family_id 
        AND fm2.user_id != p_user_id 
        AND public.is_active_family_guardian(v_fam.family_id, fm2.user_id)
      ) INTO v_has_other_parent;

      IF v_has_other_parent THEN
        IF p_successor_user_id IS NULL OR p_successor_user_id = p_user_id THEN
          RETURN QUERY SELECT false, 'successor_required'::TEXT;
          RETURN;
        END IF;

        v_successor_valid := public.is_active_family_guardian(v_fam.family_id, p_successor_user_id);

        IF NOT v_successor_valid THEN
          RETURN QUERY SELECT false, 'successor_required'::TEXT;
          RETURN;
        END IF;

        -- 승계 처리
        UPDATE public.family_members 
        SET role = 'owner_parent' 
        WHERE family_id = v_fam.family_id AND user_id = p_successor_user_id;

        UPDATE public.families
        SET created_by = p_successor_user_id
        WHERE id = v_fam.family_id;

        -- 본인 소프트삭제
        UPDATE public.family_members 
        SET deleted_at = now() 
        WHERE family_id = v_fam.family_id AND user_id = p_user_id;
      ELSE
        -- 단독 오너 (버그 E 적용)
        IF NOT p_confirmed_last_guardian THEN 
          RETURN QUERY SELECT false, 'last_guardian_confirmation_required'::TEXT; 
          RETURN; 
        END IF;

        v_purge_batch_id := gen_random_uuid();
        -- 버그 D 적용: purge_initiated_by 기록
        UPDATE public.families 
        SET deleted_at = now(), purge_batch_id = v_purge_batch_id, purge_initiated_by = p_user_id
        WHERE id = v_fam.family_id;

        UPDATE public.family_members 
        SET deleted_at = now() 
        WHERE family_id = v_fam.family_id;
      END IF;
    ELSE
      -- 일반 보호자나 자녀
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

REVOKE EXECUTE ON FUNCTION public.request_account_withdrawal(UUID, TEXT, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_withdrawal(UUID, TEXT, UUID, BOOLEAN) TO service_role;

-- 버그 C: request_account_restore
CREATE OR REPLACE FUNCTION public.request_account_restore(p_user_id UUID)
RETURNS TABLE(success BOOLEAN, reason TEXT)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
  v_purge_scheduled_at TIMESTAMPTZ;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('account_withdrawal_' || p_user_id::text));

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

-- 버그 C, D: admin_approve_account_restore
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

-- 버그 C: admin_reject_account_restore
CREATE OR REPLACE FUNCTION public.admin_reject_account_restore(p_admin_user_id UUID, p_admin_email TEXT, p_target_user_id UUID, p_reason TEXT)
RETURNS TABLE(success BOOLEAN, reason TEXT)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('account_withdrawal_' || p_target_user_id::text));

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

-- 버그 C: purge_account_family_data
CREATE OR REPLACE FUNCTION public.purge_account_family_data(p_user_id UUID)
RETURNS void
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_family_ids UUID[];
  v_lock RECORD;
  v_parent_record RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('account_withdrawal_' || p_user_id::text));

  -- Lock families
  FOR v_lock IN SELECT family_id FROM public.family_members WHERE user_id = p_user_id ORDER BY family_id LOOP
    PERFORM pg_advisory_xact_lock(hashtext('family_withdrawal_' || v_lock.family_id::text));
  END LOOP;

  -- Re-validate status
  SELECT account_status, purge_scheduled_at INTO v_parent_record FROM public.parents WHERE id = p_user_id;
  IF NOT FOUND OR v_parent_record.account_status != 'WITHDRAWN_PENDING' OR v_parent_record.purge_scheduled_at IS NULL OR v_parent_record.purge_scheduled_at > now() THEN
    RETURN;
  END IF;

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
