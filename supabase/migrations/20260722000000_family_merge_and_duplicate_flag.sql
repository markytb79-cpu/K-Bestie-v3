-- 1. child_profiles 테이블에 중복 검토용 컬럼 추가
ALTER TABLE public.child_profiles
  ADD COLUMN IF NOT EXISTS duplicate_review_child_id UUID REFERENCES public.child_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS duplicate_flagged_at TIMESTAMPTZ NULL;

-- 2. accept_family_invite RPC 함수 수정 (conflict_existing_family 정책을 병합 및 중복 감지로 전환)
CREATE OR REPLACE FUNCTION public.accept_family_invite(
  p_request_id UUID,
  p_user_id UUID,
  p_user_email TEXT
) RETURNS TABLE (
  success BOOLEAN,
  reason TEXT,
  previous_family_id UUID
) AS $$
DECLARE
  v_target_family_id UUID;
  v_status TEXT;
  v_direction TEXT;
  v_target_user_id UUID;
  v_requester_email TEXT;
  v_already_member BOOLEAN;
  v_old_family_id UUID;
  v_old_family_id_auth UUID;
  v_old_member_count INT;
  v_parent_count INT;
BEGIN
  -- 1. p_request_id로 family_join_requests에서 family_id 조회 (락 없이 1차 조회)
  SELECT family_join_requests.family_id INTO v_target_family_id
  FROM public.family_join_requests
  WHERE family_join_requests.id = p_request_id;

  IF v_target_family_id IS NULL THEN
    RETURN QUERY SELECT false, 'not_found'::text, NULL::UUID;
    RETURN;
  END IF;

  -- 2. p_user_id로 현재 소속된 기존 family_id 조회 (락 없이 참고용 1차 조회)
  SELECT family_members.family_id INTO v_old_family_id
  FROM public.family_members
  WHERE family_members.user_id = p_user_id
  LIMIT 1;

  -- 3. 두 family_id를 비교 정렬하여 항상 사전식 순서가 작은 UUID부터 락 획득 (데드락 40P01 예방)
  IF v_old_family_id IS NOT NULL AND v_old_family_id IS DISTINCT FROM v_target_family_id THEN
    IF v_target_family_id::text < v_old_family_id::text THEN
      PERFORM pg_advisory_xact_lock(hashtext(v_target_family_id::text));
      PERFORM pg_advisory_xact_lock(hashtext(v_old_family_id::text));
    ELSE
      PERFORM pg_advisory_xact_lock(hashtext(v_old_family_id::text));
      PERFORM pg_advisory_xact_lock(hashtext(v_target_family_id::text));
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext(v_target_family_id::text));
  END IF;

  -- 4. 락 획득 후, 기존 family_id를 다시 조회하여 TOCTOU 및 동시성 상태 변경 방지 (Authoritative 조회)
  SELECT family_members.family_id INTO v_old_family_id_auth
  FROM public.family_members
  WHERE family_members.user_id = p_user_id
  LIMIT 1;

  -- 만약 락 획득 전후의 기존 가족 정보가 다르면, 동시성 트랜잭션 충돌로 간주하고 40001 예외 던지기
  IF v_old_family_id IS DISTINCT FROM v_old_family_id_auth THEN
    RAISE EXCEPTION 'concurrent_family_change' USING ERRCODE = '40001';
  END IF;

  -- 5. 락 하에서 status, direction, target_user_id, requester_email 재조회 (FOR UPDATE)
  SELECT
    family_join_requests.status,
    family_join_requests.direction,
    family_join_requests.target_user_id,
    family_join_requests.requester_email
  INTO
    v_status,
    v_direction,
    v_target_user_id,
    v_requester_email
  FROM public.family_join_requests
  WHERE family_join_requests.id = p_request_id
  FOR UPDATE;

  -- 6. direction 검증
  IF v_direction IS DISTINCT FROM 'owner_invite' THEN
    RETURN QUERY SELECT false, 'invalid_direction'::text, NULL::UUID;
    RETURN;
  END IF;

  -- 7. 이메일/사용자 일치 재검증
  IF v_target_user_id IS NOT NULL THEN
    IF v_target_user_id IS DISTINCT FROM p_user_id THEN
      RETURN QUERY SELECT false, 'not_authorized'::text, NULL::UUID;
      RETURN;
    END IF;
  ELSE
    IF v_requester_email IS NULL OR LOWER(TRIM(v_requester_email)) IS DISTINCT FROM LOWER(TRIM(p_user_email)) THEN
      RETURN QUERY SELECT false, 'not_authorized'::text, NULL::UUID;
      RETURN;
    END IF;
  END IF;

  -- 8. 이미 대상 가족의 구성원인지 확인 (멱등성)
  SELECT EXISTS(
    SELECT 1
    FROM public.family_members
    WHERE family_members.family_id = v_target_family_id
      AND family_members.user_id = p_user_id
  ) INTO v_already_member;

  IF v_already_member THEN
    UPDATE public.family_join_requests
    SET status = 'approved',
        target_user_id = p_user_id,
        reviewed_by = p_user_id,
        reviewed_at = now()
    WHERE family_join_requests.id = p_request_id;

    RETURN QUERY SELECT true, 'already_member'::text, NULL::UUID;
    RETURN;
  END IF;

  -- 9. status 검증
  IF v_status IS DISTINCT FROM 'pending' AND v_status IS DISTINCT FROM 'approved' THEN
    RETURN QUERY SELECT false, 'already_processed'::text, NULL::UUID;
    RETURN;
  END IF;

  -- 10. 대상 가족 존재 여부 확인
  IF NOT EXISTS(
    SELECT 1
    FROM public.families
    WHERE families.id = v_target_family_id
  ) THEN
    RETURN QUERY SELECT false, 'family_not_found'::text, NULL::UUID;
    RETURN;
  END IF;

  -- 11. 기존 가족 검증 (v_old_family_id_auth가 있고 대상 가족과 다를 경우)
  IF v_old_family_id_auth IS NOT NULL AND v_old_family_id_auth IS DISTINCT FROM v_target_family_id THEN
    -- 기존 가족에 본인 외 보호자(owner_parent, parent)가 존재하는지 확인
    SELECT COUNT(*) INTO v_old_member_count
    FROM public.family_members
    WHERE family_members.family_id = v_old_family_id_auth
      AND family_members.role IN ('owner_parent', 'parent')
      AND family_members.user_id IS DISTINCT FROM p_user_id;

    -- 본인 외 보호자가 1명이라도 존재하면 자동 병합 절대 금지
    IF v_old_member_count > 0 THEN
      RETURN QUERY SELECT false, 'other_guardian_conflict'::text, v_old_family_id_auth;
      RETURN;
    END IF;
  END IF;

  -- 12. 대상 가족 정원 검증 (보호자는 2명 이하)
  SELECT COUNT(*) INTO v_parent_count
  FROM public.family_members
  WHERE family_members.family_id = v_target_family_id
    AND family_members.role IN ('owner_parent', 'parent');

  IF v_parent_count >= 2 THEN
    RETURN QUERY SELECT false, 'capacity_full'::text, NULL::UUID;
    RETURN;
  END IF;

  -- 13. 기존 가족 정리 및 데이터 병합 (다른 보호자가 없는 경우)
  IF v_old_family_id_auth IS NOT NULL AND v_old_family_id_auth IS DISTINCT FROM v_target_family_id THEN
    -- f. 중복 자녀 후보 탐지 및 플래그 설정
    -- 대상 가족 자녀 중 이름이 겹치는 아이에 플래그
    UPDATE public.child_profiles AS c_target
    SET duplicate_review_child_id = c_old.id,
        duplicate_flagged_at = now()
    FROM public.child_profiles AS c_old
    WHERE c_target.family_id = v_target_family_id
      AND c_old.family_id = v_old_family_id_auth
      AND TRIM(LOWER(c_target.name)) = TRIM(LOWER(c_old.name))
      AND c_target.name IS NOT NULL AND TRIM(c_target.name) != ''
      AND c_old.name IS NOT NULL AND TRIM(c_old.name) != '';

    -- 기존 가족 자녀 중 이름이 겹치는 아이에 플래그
    UPDATE public.child_profiles AS c_old
    SET duplicate_review_child_id = c_target.id,
        duplicate_flagged_at = now()
    FROM public.child_profiles AS c_target
    WHERE c_old.family_id = v_old_family_id_auth
      AND c_target.family_id = v_target_family_id
      AND TRIM(LOWER(c_old.name)) = TRIM(LOWER(c_target.name))
      AND c_old.name IS NOT NULL AND TRIM(c_old.name) != ''
      AND c_target.name IS NOT NULL AND TRIM(c_target.name) != '';

    -- a. 기존 가족의 child_profiles.family_id를 대상 가족으로 UPDATE
    UPDATE public.child_profiles
    SET family_id = v_target_family_id
    WHERE child_profiles.family_id = v_old_family_id_auth;

    -- b. 기존 가족의 child(role='child') family_members 행들도 family_id를 대상 가족으로 UPDATE
    UPDATE public.family_members
    SET family_id = v_target_family_id
    WHERE family_members.family_id = v_old_family_id_auth
      AND family_members.role = 'child';

    -- c. member_accounts.family_id가 기존 가족을 가리키는 행들을 대상 가족으로 UPDATE
    UPDATE public.member_accounts
    SET family_id = v_target_family_id
    WHERE member_accounts.family_id = v_old_family_id_auth;

    -- d. child_invite_codes.family_id가 기존 가족을 가리키는 행들을 대상 가족으로 UPDATE
    UPDATE public.child_invite_codes
    SET family_id = v_target_family_id
    WHERE child_invite_codes.family_id = v_old_family_id_auth;

    -- e. account_management_audit_log.family_id가 기존 가족을 가리키는 행들을 대상 가족으로 UPDATE
    UPDATE public.account_management_audit_log
    SET family_id = v_target_family_id
    WHERE account_management_audit_log.family_id = v_old_family_id_auth;

    -- g. 본인의 family_members (기존 가족, 보호자 역할) 행 삭제
    DELETE FROM public.family_members
    WHERE family_members.family_id = v_old_family_id_auth
      AND family_members.user_id = p_user_id
      AND family_members.role IN ('owner_parent', 'parent');

    -- i. 기존 가족의 가입 요청 soft-cancel
    UPDATE public.family_join_requests
    SET status = 'cancelled'
    WHERE family_join_requests.family_id = v_old_family_id_auth
      AND family_join_requests.status IN ('pending', 'approved');

    -- h. 기존 가족(families 행) 삭제
    DELETE FROM public.families
    WHERE families.id = v_old_family_id_auth;
  END IF;

  -- 14. 대상 가족 멤버십 생성
  INSERT INTO public.family_members (family_id, user_id, role)
  VALUES (v_target_family_id, p_user_id, 'parent');

  -- 15. 초대 요청 상태 갱신
  UPDATE public.family_join_requests
  SET status = 'approved',
      target_user_id = p_user_id,
      reviewed_by = p_user_id,
      reviewed_at = now()
  WHERE family_join_requests.id = p_request_id;

  -- 16. 결과 반환
  RETURN QUERY SELECT true, 'ok'::text, v_old_family_id_auth;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.accept_family_invite(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_family_invite(UUID, UUID, TEXT) TO service_role;
