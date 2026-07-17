-- 초안 (DDL DRAFT ONLY) — 실행 금지, 대표 승인 후 대표가 직접 실행할 것
-- 목적: daily_reports / weekly_summaries / parent_questions의 SELECT(및 ALL) 정책이
--   family_members.role을 구분하지 않아, 아이 계정(role='child')이 Supabase REST를 직접
--   호출하면 부모 전용 데이터(리포트, 부모가 등록한 질문)를 읽을 수 있는 경로가 열려 있다.
--   PRD 점검(2026-07-15)에서 발견된 갭 — 이 마이그레이션은 그 3개 테이블의 정책만
--   owner_parent/parent 역할로 좁힌다.
--
-- 범위 밖(의도적으로 손대지 않음):
--   - child_profiles, chat_sessions: 아이 자신의 접근이 필요할 수 있어 이번 범위 제외.
--   - chat_messages: 이미 service_role 전용이라 원래도 아이 계정이 REST로 직접 못 읽음(변경 불필요).
--   - report_views: daily_reports 열람 로그일 뿐 원문 데이터가 아니라 이번 범위 제외
--     (필요하면 별도 검토).
--
-- 적용 방식: 기존 정책을 DROP 후 동일 이름으로 재생성(정책명 유지로 마이그레이션 이력 추적 용이).
--   service_role 조건은 그대로 유지 — 백엔드(Edge Function/Next API)는 항상 service_role로
--   호출하므로 영향 없음. 실제 영향받는 건 "부모/아이 계정이 자신의 Supabase 세션 JWT로
--   PostgREST를 직접 호출하는" 경로뿐이다.

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
      WHERE cs.id = daily_reports.session_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
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
      WHERE cp.id = weekly_summaries.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );

-- ── parent_questions ───────────────────────────────────────────
-- 기존엔 FOR ALL(SELECT/INSERT/UPDATE/DELETE 전부)이 같은 조건이었다. 부모만 조회/등록/수정
-- 가능하도록 role 조건을 추가한다(아이는 자신에게 무슨 질문이 등록됐는지 REST로 못 읽음 —
-- 케이가 대화 중 그 질문을 자연스럽게 녹여서 물어보는 게 원래 취지이지, 아이가 목록을 열람하는
-- 기능이 아니었으므로 동작 변경 없음).
DROP POLICY IF EXISTS "parent_questions_access" ON parent_questions;

CREATE POLICY "parent_questions_access"
  ON parent_questions FOR ALL
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = parent_questions.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = parent_questions.child_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );

-- 적용 전 확인 권장(SQL Editor에서 드라이런):
--   개발 중인 아이 계정으로 로그인한 세션 JWT로 다음이 전부 빈 결과([])가 되는지 확인:
--     select * from daily_reports;
--     select * from weekly_summaries;
--     select * from parent_questions;
--   (같은 세션으로 부모 계정 테스트 시에는 기존과 동일하게 조회되어야 한다.)
