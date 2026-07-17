-- 롤백 초안 (DDL DRAFT ONLY) — 실행 금지, 대표 승인 후 대표가 직접 실행할 것
-- 대상: 20260716000000_rls_parent_only_role_guard.sql
-- 목적: daily_reports / weekly_summaries / parent_questions 정책을 그 마이그레이션 적용 전
--   상태(가족 구성원이면 role 무관하게 조회 가능하던 정책, 20260609400000_family_clean_slate.sql
--   원본 그대로)로 되돌린다. 정책명은 동일하게 유지한다(DROP 후 재생성).
--
-- 사용 시점: 마이그레이션 적용 후 회귀(부모 계정이 자기 아이 리포트를 못 보는 등)가 발견되어
--   즉시 원복이 필요할 때만 사용. 평상시에는 적용하지 않는다.

-- ── daily_reports ──────────────────────────────────────────────
DROP POLICY IF EXISTS "daily_reports_select" ON daily_reports;

CREATE POLICY "daily_reports_select"
  ON daily_reports FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM chat_sessions cs
      JOIN child_profiles cp ON cp.id = cs.child_id
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cs.id = daily_reports.session_id AND fm.user_id = auth.uid()
    )
  );

-- ── weekly_summaries ───────────────────────────────────────────
DROP POLICY IF EXISTS "weekly_summaries_select" ON weekly_summaries;

CREATE POLICY "weekly_summaries_select"
  ON weekly_summaries FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = weekly_summaries.child_id AND fm.user_id = auth.uid()
    )
  );

-- ── parent_questions ───────────────────────────────────────────
DROP POLICY IF EXISTS "parent_questions_access" ON parent_questions;

CREATE POLICY "parent_questions_access"
  ON parent_questions FOR ALL
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = parent_questions.child_id AND fm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = parent_questions.child_id AND fm.user_id = auth.uid()
    )
  );
