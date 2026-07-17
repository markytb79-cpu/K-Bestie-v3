-- DRAFT: 실행 전 사용자 승인 필요, 아직 미적용
-- 목적: 20260717150100_admin_roles.sql 에 대한 롤백

-- 방어적 체크: question_review_history가 아직 존재하면 RLS와 FK 참조 구조 무너짐을 방지하기 위해 롤백을 차단
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' AND tablename = 'question_review_history'
  ) THEN
    RAISE EXCEPTION 'Cannot drop admin_roles because question_review_history still exists. Roll back question_engine_new_tables first.';
  END IF;
END $$;

DROP TABLE IF EXISTS admin_roles;
DROP FUNCTION IF EXISTS get_admin_role(uuid);
