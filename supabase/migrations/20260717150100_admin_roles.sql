-- DRAFT: 실행 전 사용자 승인 필요, 아직 미적용
-- 목적: '질문·대화 엔진' 관리자 역할 및 권한 정의 (PR1)

-- 1. admin_roles 테이블 생성
CREATE TABLE admin_roles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL CHECK (role IN ('ADMIN', 'REVIEWER', 'VIEWER')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT
);

CREATE INDEX idx_admin_roles_email ON admin_roles (email);

-- 2. 권한 매트릭스 정의 (주석 문서화)
-- =========================================================================
--  역할 (Role) | 판정(clinical_status 변경) | 수정(질문 텍스트 등) | 활성화(is_active) | 역할 배정
-- ------------+--------------------------+---------------------+-----------------+----------
--  ADMIN      | O                        | O                   | O               | O
--  REVIEWER   | O                        | O (의견/코멘트만)     | X               | X
--  VIEWER     | X                        | X                   | X               | X
-- =========================================================================

-- 3. RLS 방지용 헬퍼 함수 정의
-- SECURITY DEFINER를 사용하여 admin_roles 테이블 조회 시 RLS 재귀 호출을 막습니다.
CREATE OR REPLACE FUNCTION get_admin_role(user_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role FROM admin_roles WHERE id = user_id;
$$;

-- 4. RLS 정책 설정
ALTER TABLE admin_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all_admin_roles"
  ON admin_roles FOR ALL
  USING (auth.role() = 'service_role');

-- 본인 역할 조회 및 어드민 관리자의 모든 권한
CREATE POLICY "admin_roles_select"
  ON admin_roles FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR id = auth.uid()
    OR get_admin_role(auth.uid()) = 'ADMIN'
  );

CREATE POLICY "admin_roles_insert"
  ON admin_roles FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR get_admin_role(auth.uid()) = 'ADMIN'
  );

CREATE POLICY "admin_roles_update"
  ON admin_roles FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR get_admin_role(auth.uid()) = 'ADMIN'
  );

CREATE POLICY "admin_roles_delete"
  ON admin_roles FOR DELETE
  USING (
    auth.role() = 'service_role'
    OR get_admin_role(auth.uid()) = 'ADMIN'
  );

-- 4. 부트스트랩 시드 안내
-- =========================================================================
--  배포 시 기존 ADMIN_EMAILS 환경변수 목록을 조회하여, 해당 사용자들이 가입할 때
--  이 테이블에 'ADMIN' 역할로 레코드를 자동 또는 수동으로 삽입해야 합니다.
--  예시 SQL:
--  INSERT INTO admin_roles (id, email, role, created_by)
--  VALUES ('<auth_user_uuid>', 'admin@example.com', 'ADMIN', 'SYSTEM')
--  ON CONFLICT (email) DO NOTHING;
-- =========================================================================
