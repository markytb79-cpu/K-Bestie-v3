-- ================================================================
-- 소셜 로그인 전환 마이그레이션 (2026-06-11)
-- 이메일+비밀번호/매직링크 제거, 카카오·구글 소셜 로그인 전용
-- ================================================================
-- 변경 내용:
--   1. child_profiles(email) 인덱스 추가 → auto-join 이메일 매칭 속도
--   2. parent_invitations(invited_email) 인덱스 추가 → 동일 목적
--   (테이블 구조 변경 없음 — 기존 스키마로 소셜 로그인 지원 가능)
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_child_profiles_email
  ON child_profiles(email);

CREATE INDEX IF NOT EXISTS idx_parent_inv_invited_email
  ON parent_invitations(invited_email);

-- 검증
-- SELECT indexname FROM pg_indexes WHERE tablename IN ('child_profiles','parent_invitations') ORDER BY tablename, indexname;
