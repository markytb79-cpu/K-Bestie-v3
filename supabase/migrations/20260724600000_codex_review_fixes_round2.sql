-- 2차 Codex 리뷰 버그 수정 (CRITICAL 1건, MEDIUM 1건)

-- 버그 3: create_family_with_owner 에서 family_members.user_id UNIQUE 위반 시 already_member 반환
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
  BEGIN
    INSERT INTO public.family_members (family_id, user_id, role) 
    VALUES (v_new_family_id, p_user_id, 'owner_parent');
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ, 'already_member'::TEXT;
    RETURN;
  END;

  -- 4. 전부 성공
  RETURN QUERY SELECT v_new_family_id, p_name, v_new_created_at, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.create_family_with_owner FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_family_with_owner TO service_role;

-- 버그 1: purge_account_family_data 가 본인이 탈퇴를 시작한 가족만 파기하도록 제한 (purge_initiated_by 조건 추가)
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
  AND f.purge_batch_id IS NOT NULL
  AND f.purge_initiated_by = p_user_id;

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
