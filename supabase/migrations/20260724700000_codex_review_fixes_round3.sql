-- 버그 수정: create_family_with_owner 에서 family_members UNIQUE 위반 시 families INSERT도 롤백되도록 BEGIN ... EXCEPTION 블록 조정
CREATE OR REPLACE FUNCTION public.create_family_with_owner(p_user_id UUID, p_name TEXT)
RETURNS TABLE(family_id UUID, family_name TEXT, created_at TIMESTAMPTZ, error_code TEXT)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_family_id UUID;
  v_new_created_at TIMESTAMPTZ;
BEGIN
  -- 1. 이미 다른 가족에 속해있는지 확인 (활성 멤버)
  IF EXISTS (SELECT 1 FROM public.family_members WHERE user_id = p_user_id AND deleted_at IS NULL) THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ, 'already_member'::TEXT;
    RETURN;
  END IF;

  -- 2. families INSERT 와 family_members INSERT 를 하나의 블록으로 묶어 롤백 보장
  BEGIN
    INSERT INTO public.families (name, created_by) 
    VALUES (p_name, p_user_id) 
    RETURNING id, public.families.created_at INTO v_new_family_id, v_new_created_at;

    INSERT INTO public.family_members (family_id, user_id, role) 
    VALUES (v_new_family_id, p_user_id, 'owner_parent');
  EXCEPTION WHEN unique_violation THEN
    -- 과거에 속했던 가족에서 탈퇴하여 deleted_at이 세팅된 row가 남아있어 UNIQUE(user_id)에 걸리는 경우
    -- families 테이블에 INSERT 된 내용도 이 예외 처리 블록으로 인해 자동으로 롤백됨 (고아 row 생성 방지)
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ, 'already_member'::TEXT;
    RETURN;
  END;

  -- 3. 전부 성공
  RETURN QUERY SELECT v_new_family_id, p_name, v_new_created_at, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.create_family_with_owner FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_family_with_owner TO service_role;
