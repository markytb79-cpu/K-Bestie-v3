-- 1. family_members 테이블에 user_id UNIQUE 제약 추가
-- (이미 Production 데이터가 1인 1가족으로 정리되어 있음을 확인 완료)
ALTER TABLE public.family_members ADD CONSTRAINT family_members_user_id_key UNIQUE (user_id);

-- 2. accept_family_invite RPC 함수 수정 (데드락 방지 및 락 순서 정규화)
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
  v_old_child_count INT;
  v_old_audit_count INT;
  v_parent_count INT;
BEGIN
  -- 1. p_request_id로 family_join_requests에서 family_id 조회 (락 없이 1차 조회)
  SELECT family_join_requests.family_id INTO v_target_family_id
  FROM family_join_requests
  WHERE family_join_requests.id = p_request_id;

  IF v_target_family_id IS NULL THEN
    RETURN QUERY SELECT false, 'not_found'::text, NULL::UUID;
    RETURN;
  END IF;

  -- 2. p_user_id로 현재 소속된 기존 family_id 조회 (락 없이 참고용 1차 조회)
  SELECT family_members.family_id INTO v_old_family_id
  FROM family_members
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
  FROM family_members
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
  FROM family_join_requests
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

  -- 9. status 검증
  IF v_status IS DISTINCT FROM 'pending' AND v_status IS DISTINCT FROM 'approved' THEN
    RETURN QUERY SELECT false, 'already_processed'::text, NULL::UUID;
    RETURN;
  END IF;

  -- 10. 대상 가족 존재 여부 확인
  IF NOT EXISTS(
    SELECT 1
    FROM families
    WHERE families.id = v_target_family_id
  ) THEN
    RETURN QUERY SELECT false, 'family_not_found'::text, NULL::UUID;
    RETURN;
  END IF;

  -- 11. 기존 가족 검증 (v_old_family_id_auth가 있고 대상 가족과 다를 경우)
  IF v_old_family_id_auth IS NOT NULL AND v_old_family_id_auth IS DISTINCT FROM v_target_family_id THEN
    -- 구성원 수 조회
    SELECT COUNT(*) INTO v_old_member_count
    FROM family_members
    WHERE family_members.family_id = v_old_family_id_auth;

    -- 자녀 수 조회
    SELECT COUNT(*) INTO v_old_child_count
    FROM child_profiles
    WHERE child_profiles.family_id = v_old_family_id_auth;

    -- 감사 로그 수 조회
    SELECT COUNT(*) INTO v_old_audit_count
    FROM account_management_audit_log
    WHERE account_management_audit_log.family_id = v_old_family_id_auth;

    -- 이 사용자 외 다른 구성원이 존재하거나 자녀가 있거나 감사 로그가 존재한다면 즉시 중단 (롤백)
    IF v_old_member_count > 1 OR v_old_child_count > 0 OR v_old_audit_count > 0 THEN
      RETURN QUERY SELECT false, 'conflict_existing_family'::text, v_old_family_id_auth;
      RETURN;
    END IF;
  END IF;

  -- 12. 대상 가족 정원 검증 (보호자는 2명 이하)
  SELECT COUNT(*) INTO v_parent_count
  FROM family_members
  WHERE family_members.family_id = v_target_family_id
    AND family_members.role IN ('owner_parent', 'parent');

  IF v_parent_count >= 2 THEN
    RETURN QUERY SELECT false, 'capacity_full'::text, NULL::UUID;
    RETURN;
  END IF;

  -- 13. 안전 판단된 기존 가족 정리 (v_old_family_id_auth가 있고 대상 가족과 다를 경우)
  IF v_old_family_id_auth IS NOT NULL AND v_old_family_id_auth IS DISTINCT FROM v_target_family_id THEN
    -- 수동 정리: FK 없는 family_join_requests 먼저 수동 삭제
    DELETE FROM family_join_requests
    WHERE family_join_requests.family_id = v_old_family_id_auth;

    -- families 삭제 (CASCADE로 family_members, child_profiles, audit_log 등 연쇄 삭제)
    DELETE FROM families
    WHERE families.id = v_old_family_id_auth;
  END IF;

  -- 14. 대상 가족 멤버십 생성
  INSERT INTO family_members (family_id, user_id, role)
  VALUES (v_target_family_id, p_user_id, 'parent');

  -- 15. 초대 요청 상태 갱신
  UPDATE family_join_requests
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

-- 3. 2-Pass 백필 마이그레이션 (사용자가 최소 1개의 가족 멤버십을 유지하도록 함)
DO $$
DECLARE
  r RECORD;
  v_dup_user_count INT;
  v_deleted_count INT := 0;
  v_family_record RECORD;
  v_has_undeletable BOOLEAN;
  v_oldest_family_id UUID;
BEGIN
  -- 실행 전 다중 가족 멤버십 보유 사용자 수 계산
  SELECT COUNT(*) INTO v_dup_user_count
  FROM (
    SELECT family_members.user_id
    FROM family_members
    GROUP BY family_members.user_id
    HAVING COUNT(*) > 1
  ) AS t;

  RAISE NOTICE '2-Pass 백필 시작: 다중 가족 멤버십 보유 사용자 수 = %', COALESCE(v_dup_user_count, 0);

  -- 다중 가족 사용자 루프
  FOR r IN (
    SELECT family_members.user_id
    FROM family_members
    GROUP BY family_members.user_id
    HAVING COUNT(*) > 1
  ) LOOP
    v_has_undeletable := false;
    v_oldest_family_id := null;

    -- 가입일(joined_at)이 가장 빠른 가족 ID 조회 (동률일 경우 family_id 정렬로 고정)
    SELECT fm.family_id INTO v_oldest_family_id
    FROM family_members fm
    WHERE fm.user_id = r.user_id
    ORDER BY fm.joined_at ASC, fm.family_id ASC
    LIMIT 1;

    -- 삭제 불가 가족이 존재하는지 판단 (자신 외 멤버가 있거나 자녀가 있거나 감사로그가 존재함)
    SELECT EXISTS (
      SELECT 1
      FROM family_members fm
      WHERE fm.user_id = r.user_id
        AND (
          (SELECT COUNT(*) FROM family_members fm2 WHERE fm2.family_id = fm.family_id) > 1
          OR (SELECT COUNT(*) FROM child_profiles cp WHERE cp.family_id = fm.family_id) > 0
          OR (SELECT COUNT(*) FROM account_management_audit_log al WHERE al.family_id = fm.family_id) > 0
        )
    ) INTO v_has_undeletable;

    IF v_has_undeletable THEN
      -- 삭제 불가 가족이 하나라도 존재함:
      -- 삭제 가능한 완전히 빈 가족(solo, member=1, child=0, audit=0)들은 전부 삭제해도 안전 (삭제 불가 가족이 남게 되므로)
      FOR v_family_record IN (
        SELECT fm.family_id
        FROM family_members fm
        WHERE fm.user_id = r.user_id
      ) LOOP
        IF (SELECT COUNT(*) FROM family_members fm2 WHERE fm2.family_id = v_family_record.family_id) = 1
           AND (SELECT COUNT(*) FROM child_profiles cp WHERE cp.family_id = v_family_record.family_id) = 0
           AND (SELECT COUNT(*) FROM account_management_audit_log al WHERE al.family_id = v_family_record.family_id) = 0 THEN

          RAISE NOTICE '사용자 %의 빈 가족 %를 2-Pass 백필 정리합니다. (다른 보존할 가족이 존재함)', r.user_id, v_family_record.family_id;

          -- FK 없는 테이블 정리 및 families 삭제
          DELETE FROM family_join_requests WHERE family_join_requests.family_id = v_family_record.family_id;
          DELETE FROM families WHERE families.id = v_family_record.family_id;
          v_deleted_count := v_deleted_count + 1;
        END IF;
      END LOOP;
    ELSE
      -- 모든 가족이 삭제 가능한 상태 (완전히 빈 solo 상태만 가진 경우):
      -- joined_at이 가장 이른 하나(v_oldest_family_id)만 보존하고 나머지는 전부 삭제
      FOR v_family_record IN (
        SELECT fm.family_id
        FROM family_members fm
        WHERE fm.user_id = r.user_id
          AND fm.family_id IS DISTINCT FROM v_oldest_family_id
      ) LOOP
        RAISE NOTICE '사용자 %의 빈 가족 %를 2-Pass 백필 정리합니다. (가장 이른 가족 % 보존)', r.user_id, v_family_record.family_id, v_oldest_family_id;

        -- FK 없는 테이블 정리 및 families 삭제
        DELETE FROM family_join_requests WHERE family_join_requests.family_id = v_family_record.family_id;
        DELETE FROM families WHERE families.id = v_family_record.family_id;
        v_deleted_count := v_deleted_count + 1;
      END LOOP;
    END IF;
  END LOOP;

  RAISE NOTICE '2-Pass 백필 종료: 삭제된 빈 가족 수 = %', v_deleted_count;
END $$;
