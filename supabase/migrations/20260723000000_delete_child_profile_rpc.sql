-- 1. delete_child_profile RPC 추가 마이그레이션
-- 가족 오너(owner_parent)에 의해서만 자녀의 데이터와 로그인 계정을 완벽히 파괴적으로 제거하는 트랜잭션 RPC

CREATE OR REPLACE FUNCTION public.delete_child_profile(
  p_child_id UUID,
  p_user_id UUID
)
RETURNS TABLE (
  success BOOLEAN,
  reason TEXT,
  deleted_user_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_family_id UUID;
  v_member_id UUID;
  v_child_auth_user_id UUID;
  v_owner_count INT;
  v_session_ids UUID[];
  v_daily_report_ids UUID[];
BEGIN
  -- 1. 자녀 프로필 및 소속 가족, 멤버 ID 조회
  SELECT cp.family_id, cp.member_id
  INTO v_family_id, v_member_id
  FROM public.child_profiles cp
  WHERE cp.id = p_child_id;

  IF v_family_id IS NULL THEN
    success := false;
    reason := 'not_found';
    deleted_user_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- 2. 호출자가 해당 가족의 owner_parent인지 검증
  SELECT COUNT(1)
  INTO v_owner_count
  FROM public.family_members fm
  WHERE fm.family_id = v_family_id
    AND fm.user_id = p_user_id
    AND fm.role = 'owner_parent';

  IF v_owner_count = 0 THEN
    success := false;
    reason := 'not_authorized';
    deleted_user_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- 3. 자녀의 auth.users 매핑 계정 ID 조회
  IF v_member_id IS NOT NULL THEN
    SELECT fm.user_id
    INTO v_child_auth_user_id
    FROM public.family_members fm
    WHERE fm.id = v_member_id
      AND fm.role = 'child';
  END IF;

  -- 4. chat_sessions ID 배열 확보
  SELECT COALESCE(array_agg(cs.id), '{}')
  INTO v_session_ids
  FROM public.chat_sessions cs
  WHERE cs.child_id = p_child_id;

  -- 5. daily_reports ID 배열 확보 (chat_sessions.id 기준)
  SELECT COALESCE(array_agg(dr.id), '{}')
  INTO v_daily_report_ids
  FROM public.daily_reports dr
  WHERE dr.session_id = ANY(v_session_ids);

  -- 6. 수동 삭제 정리 (FK가 없거나 CASCADE가 걸려있더라도 트랜잭션의 명시성 확보)
  -- 6.1. evidence_card_links (daily_reports 참조)
  IF array_length(v_daily_report_ids, 1) > 0 THEN
    DELETE FROM public.evidence_card_links ecl
    WHERE ecl.daily_report_id = ANY(v_daily_report_ids);

    -- 6.2. report_views (daily_reports 참조)
    DELETE FROM public.report_views rv
    WHERE rv.report_id = ANY(v_daily_report_ids);
  END IF;

  -- 6.3. daily_reports 삭제
  IF array_length(v_session_ids, 1) > 0 THEN
    DELETE FROM public.daily_reports dr
    WHERE dr.session_id = ANY(v_session_ids);

    -- 6.4. chat_messages 삭제
    DELETE FROM public.chat_messages cm
    WHERE cm.session_id = ANY(v_session_ids);

    -- 6.5. mission_progress 삭제
    DELETE FROM public.mission_progress mp
    WHERE mp.session_id = ANY(v_session_ids);
  END IF;

  -- 6.6. chat_sessions 삭제 (이 단계에서 soft-deleted 세션까지 모두 물리 삭제)
  DELETE FROM public.chat_sessions cs
  WHERE cs.child_id = p_child_id;

  -- 6.7. mission_question_history 삭제
  DELETE FROM public.mission_question_history mqh
  WHERE mqh.child_id = p_child_id;

  -- 6.8. gold_key_ledger 삭제
  DELETE FROM public.gold_key_ledger gkl
  WHERE gkl.child_id = p_child_id;

  -- 6.9. usage_events 삭제
  DELETE FROM public.usage_events ue
  WHERE ue.child_id = p_child_id;

  -- 6.10. weekly_summaries 삭제
  DELETE FROM public.weekly_summaries ws
  WHERE ws.child_id = p_child_id;

  -- 7. 자녀의 family_members 행 삭제
  IF v_member_id IS NOT NULL THEN
    DELETE FROM public.family_members fm
    WHERE fm.id = v_member_id
      AND fm.role = 'child';
  END IF;

  -- 8. 자녀 프로필 삭제 (CASCADE로 k_play_sessions, parent_questions, gold_key_consumptions, audit_logs 등 최종 정리)
  DELETE FROM public.child_profiles cp
  WHERE cp.id = p_child_id;

  -- 9. 결과 반환
  success := true;
  reason := NULL;
  deleted_user_id := v_child_auth_user_id;
  RETURN NEXT;
END;
$$;

-- RLS 우회를 피하기 위한 정책 적용 여부와 무관하게 SECURITY DEFINER로 작동하며
-- DB RLS 정책 권한 부여
GRANT EXECUTE ON FUNCTION public.delete_child_profile(UUID, UUID) TO anon, authenticated, service_role;
