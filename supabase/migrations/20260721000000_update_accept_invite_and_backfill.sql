-- "가족 1인당 1멤버십" 불변조건을 강제하는 초대 수락 RPC 함수
-- 기존 accept_family_invite(UUID, UUID) 함수를 드롭하고 새 시그니처로 재정의합니다.
DROP FUNCTION IF EXISTS public.accept_family_invite(UUID, UUID);

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
  v_old_member_count INT;
  v_old_child_count INT;
  v_old_audit_count INT;
  v_parent_count INT;
BEGIN
  -- 1. p_request_id로 family_join_requests에서 family_id 조회
  SELECT family_join_requests.family_id INTO v_target_family_id
  FROM family_join_requests
  WHERE family_join_requests.id = p_request_id;

  IF v_target_family_id IS NULL THEN
    RETURN QUERY SELECT false, 'not_found'::text, NULL::UUID;
    RETURN;
  END IF;

  -- 2. 대상 가족 id로 advisory lock 선점
  PERFORM pg_advisory_xact_lock(hashtext(v_target_family_id::text));

  -- 3. 락 하에서 status, direction, target_user_id, requester_email 재조회 (FOR UPDATE)
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
  FROM family_join_requests
  WHERE family_join_requests.id = p_request_id
  FOR UPDATE;

  -- 4. direction 검증
  IF v_direction IS DISTINCT FROM 'owner_invite' THEN
    RETURN QUERY SELECT false, 'invalid_direction'::text, NULL::UUID;
    RETURN;
  END IF;

  -- 5. 이메일/사용자 일치 재검증
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

  -- 6. 이미 대상 가족의 구성원인지 확인 (멱등성)
  SELECT EXISTS(
    SELECT 1
    FROM family_members
    WHERE family_members.family_id = v_target_family_id
      AND family_members.user_id = p_user_id
  ) INTO v_already_member;

  IF v_already_member THEN
    UPDATE family_join_requests
    SET status = 'approved',
        target_user_id = p_user_id,
        reviewed_by = p_user_id,
        reviewed_at = now()
    WHERE family_join_requests.id = p_request_id;

    RETURN QUERY SELECT true, 'already_member'::text, NULL::UUID;
    RETURN;
  END IF;

  -- 7. status 검증
  IF v_status IS DISTINCT FROM 'pending' AND v_status IS DISTINCT FROM 'approved' THEN
    RETURN QUERY SELECT false, 'already_processed'::text, NULL::UUID;
    RETURN;
  END IF;

  -- 8. 대상 가족 존재 여부 확인
  IF NOT EXISTS(
    SELECT 1
    FROM families
    WHERE families.id = v_target_family_id
  ) THEN
    RETURN QUERY SELECT false, 'family_not_found'::text, NULL::UUID;
    RETURN;
  END IF;

  -- 9. 기존 가족 조회 및 검증
  SELECT family_members.family_id INTO v_old_family_id
  FROM family_members
  WHERE family_members.user_id = p_user_id
  LIMIT 1;

  IF v_old_family_id IS NOT NULL AND v_old_family_id IS DISTINCT FROM v_target_family_id THEN
    -- 기존 가족에 advisory lock 선점
    PERFORM pg_advisory_xact_lock(hashtext(v_old_family_id::text));

    -- 구성원 수 조회
    SELECT COUNT(*) INTO v_old_member_count
    FROM family_members
    WHERE family_members.family_id = v_old_family_id;

    -- 자녀 수 조회
    SELECT COUNT(*) INTO v_old_child_count
    FROM child_profiles
    WHERE child_profiles.family_id = v_old_family_id;

    -- 감사 로그 수 조회
    SELECT COUNT(*) INTO v_old_audit_count
    FROM account_management_audit_log
    WHERE account_management_audit_log.family_id = v_old_family_id;

    -- 이 사용자 외 다른 구성원이 존재하거나 자녀가 있거나 감사 로그가 존재한다면 즉시 중단 (롤백)
    IF v_old_member_count > 1 OR v_old_child_count > 0 OR v_old_audit_count > 0 THEN
      RETURN QUERY SELECT false, 'conflict_existing_family'::text, v_old_family_id;
      RETURN;
    END IF;
  END IF;

  -- 10. 대상 가족 정원 검증 (보호자는 2명 이하)
  SELECT COUNT(*) INTO v_parent_count
  FROM family_members
  WHERE family_members.family_id = v_target_family_id
    AND family_members.role IN ('owner_parent', 'parent');

  IF v_parent_count >= 2 THEN
    RETURN QUERY SELECT false, 'capacity_full'::text, NULL::UUID;
    RETURN;
  END IF;

  -- 11. 안전 판단된 기존 가족 정리 (v_old_family_id가 있고 대상 가족과 다를 경우)
  IF v_old_family_id IS NOT NULL AND v_old_family_id IS DISTINCT FROM v_target_family_id THEN
    -- 수동 정리: FK 없는 family_join_requests 먼저 수동 삭제
    DELETE FROM family_join_requests
    WHERE family_join_requests.family_id = v_old_family_id;

    -- families 삭제 (CASCADE로 family_members, child_profiles, audit_log 등 연쇄 삭제)
    DELETE FROM families
    WHERE families.id = v_old_family_id;
  END IF;

  -- 12. 대상 가족 멤버십 생성
  INSERT INTO family_members (family_id, user_id, role)
  VALUES (v_target_family_id, p_user_id, 'parent');

  -- 13. 초대 요청 상태 갱신
  UPDATE family_join_requests
  SET status = 'approved',
      target_user_id = p_user_id,
      reviewed_by = p_user_id,
      reviewed_at = now()
  WHERE family_join_requests.id = p_request_id;

  -- 14. 결과 반환
  RETURN QUERY SELECT true, 'ok'::text, v_old_family_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.accept_family_invite(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_family_invite(UUID, UUID, TEXT) TO service_role;

-- 2. 기존 다중 가족 멤버십(부적절한 설계 잔재) 백필 마이그레이션
DO $$
DECLARE
  r RECORD;
  v_dup_user_count INT;
  v_fixed_user_count INT := 0;
  v_family_record RECORD;
  v_member_count INT;
  v_child_count INT;
  v_audit_count INT;
  v_deleted_count INT := 0;
BEGIN
  -- 실행 전 다중 가족 멤버십 보유 사용자 수 계산
  SELECT COUNT(*) INTO v_dup_user_count
  FROM (
    SELECT family_members.user_id
    FROM family_members
    GROUP BY family_members.user_id
    HAVING COUNT(*) > 1
  ) AS t;

  RAISE NOTICE '백필 시작: 다중 가족 멤버십 보유 사용자 수 = %', COALESCE(v_dup_user_count, 0);

  -- 다중 가족 사용자 루프
  FOR r IN (
    SELECT family_members.user_id
    FROM family_members
    GROUP BY family_members.user_id
    HAVING COUNT(*) > 1
  ) LOOP
    -- 사용자가 속한 모든 가족 중 빈 가족들을 찾아서 정리
    FOR v_family_record IN (
      SELECT DISTINCT family_members.family_id
      FROM family_members
      WHERE family_members.user_id = r.user_id
    ) LOOP
      -- 1. 가족의 다른 보호자 수 확인
      SELECT COUNT(*) INTO v_member_count
      FROM family_members
      WHERE family_members.family_id = v_family_record.family_id;

      -- 2. 자녀 프로필 수 확인
      SELECT COUNT(*) INTO v_child_count
      FROM child_profiles
      WHERE child_profiles.family_id = v_family_record.family_id;

      -- 3. 감사 로그 수 확인
      SELECT COUNT(*) INTO v_audit_count
      FROM account_management_audit_log
      WHERE account_management_audit_log.family_id = v_family_record.family_id;

      -- 4. 본인 외 구성원이 없고, 자녀가 없고, 감사 로그도 없는 완전히 빈 가족인 경우 안전하게 삭제
      IF v_member_count = 1 AND v_child_count = 0 AND v_audit_count = 0 THEN
        RAISE NOTICE '사용자 %의 빈 가족 %를 백필 정리합니다.', r.user_id, v_family_record.family_id;

        -- FK가 없는 family_join_requests 수동 삭제
        DELETE FROM family_join_requests
        WHERE family_join_requests.family_id = v_family_record.family_id;

        -- families 테이블에서 삭제 (CASCADE에 의해 family_members 연쇄 삭제)
        DELETE FROM families
        WHERE families.id = v_family_record.family_id;

        v_deleted_count := v_deleted_count + 1;
      ELSE
        RAISE NOTICE '사용자 %의 가족 %는 빈 가족이 아니므로 보존합니다. (멤버수: %, 자녀수: %, 감사로그수: %)',
          r.user_id, v_family_record.family_id, v_member_count, v_child_count, v_audit_count;
      END IF;
    END LOOP;
  END LOOP;

  -- 실행 후 다중 가족 멤버십 보유 사용자 수 계산
  SELECT COUNT(*) INTO v_fixed_user_count
  FROM (
    SELECT family_members.user_id
    FROM family_members
    GROUP BY family_members.user_id
    HAVING COUNT(*) > 1
  ) AS t;

  RAISE NOTICE '백필 종료: 삭제된 빈 가족 수 = %, 백필 후 여전히 다중 가족 멤버십을 가진 사용자 수 = %',
    v_deleted_count, COALESCE(v_fixed_user_count, 0);
END $$;
