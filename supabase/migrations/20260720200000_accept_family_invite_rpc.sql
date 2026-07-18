-- family_id 단위 advisory lock으로 보호자 정원 검증 + family_members 연결 +
-- family_join_requests 상태갱신을 원자적으로 처리하는 RPC.
CREATE OR REPLACE FUNCTION public.accept_family_invite(
  p_request_id UUID,
  p_user_id UUID
) RETURNS TABLE (
  success BOOLEAN,
  already_member BOOLEAN,
  family_id UUID,
  reason TEXT
) AS $$
DECLARE
  v_family_id UUID;
  v_status TEXT;
  v_direction TEXT;
  v_parent_count INT;
  v_already_member BOOLEAN;
BEGIN
  -- 락 대상(family_id) 확정을 위한 사전 조회 — 상태 판단에는 재사용하지 않음.
  SELECT family_join_requests.family_id INTO v_family_id FROM family_join_requests WHERE id = p_request_id;

  IF v_family_id IS NULL THEN
    RETURN QUERY SELECT false, false, NULL::UUID, 'not_found'::text;
    RETURN;
  END IF;

  -- family_id 단위 advisory lock 최우선 획득
  PERFORM pg_advisory_xact_lock(hashtext(v_family_id::text));

  -- 락 획득 후 최신 상태 재조회(TOCTOU 방지) + FOR UPDATE
  SELECT status, direction INTO v_status, v_direction
  FROM family_join_requests WHERE id = p_request_id FOR UPDATE;

  IF v_direction IS DISTINCT FROM 'owner_invite' THEN
    RETURN QUERY SELECT false, false, v_family_id, 'invalid_direction'::text;
    RETURN;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM family_members WHERE family_members.family_id = v_family_id AND user_id = p_user_id
  ) INTO v_already_member;

  IF v_already_member THEN
    UPDATE family_join_requests
    SET status = 'approved', target_user_id = p_user_id, reviewed_by = p_user_id, reviewed_at = now()
    WHERE id = p_request_id;
    RETURN QUERY SELECT true, true, v_family_id, 'already_member'::text;
    RETURN;
  END IF;

  IF v_status <> 'pending' AND v_status <> 'approved' THEN
    RETURN QUERY SELECT false, false, v_family_id, 'already_processed'::text;
    RETURN;
  END IF;

  IF NOT EXISTS(SELECT 1 FROM families WHERE id = v_family_id) THEN
    RETURN QUERY SELECT false, false, v_family_id, 'family_not_found'::text;
    RETURN;
  END IF;

  -- 정원 재검증(락 하에 최신값 — 동시 수락 경쟁을 여기서 직렬화해 차단)
  SELECT COUNT(*) INTO v_parent_count
  FROM family_members WHERE family_members.family_id = v_family_id AND role IN ('owner_parent', 'parent');

  IF v_parent_count >= 2 THEN
    RETURN QUERY SELECT false, false, v_family_id, 'capacity_full'::text;
    RETURN;
  END IF;

  INSERT INTO family_members (family_id, user_id, role) VALUES (v_family_id, p_user_id, 'parent');

  UPDATE family_join_requests
  SET status = 'approved', target_user_id = p_user_id, reviewed_by = p_user_id, reviewed_at = now()
  WHERE id = p_request_id;

  RETURN QUERY SELECT true, false, v_family_id, 'ok'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.accept_family_invite(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_family_invite(UUID, UUID) TO service_role;
