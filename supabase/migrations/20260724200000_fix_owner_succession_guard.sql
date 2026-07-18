-- 1. Helper Function: is_active_family_guardian
CREATE OR REPLACE FUNCTION public.is_active_family_guardian(p_family_id UUID, p_user_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_active BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.family_members fm
    JOIN public.families f ON f.id = fm.family_id
    JOIN public.parents p ON p.id = fm.user_id
    WHERE fm.family_id = p_family_id
      AND fm.user_id = p_user_id
      AND fm.deleted_at IS NULL
      AND fm.role IN ('owner_parent', 'parent')
      AND f.deleted_at IS NULL
      AND p.account_status = 'ACTIVE'
  ) INTO v_is_active;
  RETURN v_is_active;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.is_active_family_guardian FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_family_guardian TO service_role;

-- 2. Modify request_account_withdrawal
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

REVOKE EXECUTE ON FUNCTION public.request_account_withdrawal FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_withdrawal TO service_role;

-- 3. Trigger Function & Triggers for integrity
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
          AND p.account_status = 'ACTIVE'
      ) THEN
        RAISE EXCEPTION 'Constraint Violation: Active family % must have at least one active owner_parent.', v_fid;
      END IF;
    END IF;
  END LOOP;

  -- Constraint B: family_members.role='owner_parent' AND deleted_at IS NULL인 모든 행은 부모가 ACTIVE여야 함
  FOR v_uid IN SELECT DISTINCT unnest(v_user_ids) LOOP
    IF EXISTS (
      SELECT 1 FROM public.family_members fm
      WHERE fm.user_id = v_uid
        AND fm.role = 'owner_parent'
        AND fm.deleted_at IS NULL
    ) THEN
      SELECT account_status INTO v_account_status FROM public.parents WHERE id = v_uid;
      IF v_account_status != 'ACTIVE' THEN
        RAISE EXCEPTION 'Constraint Violation: User % is an active owner_parent but account is not ACTIVE.', v_uid;
      END IF;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_owner_succession_guard_families ON public.families;
CREATE CONSTRAINT TRIGGER trg_owner_succession_guard_families
AFTER INSERT OR UPDATE OR DELETE ON public.families
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.fn_check_owner_succession_guard();

DROP TRIGGER IF EXISTS trg_owner_succession_guard_family_members ON public.family_members;
CREATE CONSTRAINT TRIGGER trg_owner_succession_guard_family_members
AFTER INSERT OR UPDATE OR DELETE ON public.family_members
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.fn_check_owner_succession_guard();

DROP TRIGGER IF EXISTS trg_owner_succession_guard_parents ON public.parents;
CREATE CONSTRAINT TRIGGER trg_owner_succession_guard_parents
AFTER INSERT OR UPDATE OR DELETE ON public.parents
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.fn_check_owner_succession_guard();
