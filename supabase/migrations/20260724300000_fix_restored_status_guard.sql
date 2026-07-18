-- 1. Helper Function: is_active_family_guardian (RESTORED 포함)
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
      AND p.account_status IN ('ACTIVE', 'RESTORED')
  ) INTO v_is_active;
  RETURN v_is_active;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.is_active_family_guardian FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_family_guardian TO service_role;

-- 2. Trigger Function for integrity (RESTORED 포함)
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
      IF v_account_status NOT IN ('ACTIVE', 'RESTORED') THEN
        RAISE EXCEPTION 'Constraint Violation: User % is an active owner_parent but account is not ACTIVE or RESTORED.', v_uid;
      END IF;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
