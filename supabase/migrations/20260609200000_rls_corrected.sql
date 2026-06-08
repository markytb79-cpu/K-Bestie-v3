-- ================================================================
-- 내친구 케이 v3 — RLS 재작성 (실제 스키마 검증 기준)
-- 실행 방법: Supabase Dashboard → SQL Editor에서 붙여넣기 후 실행
--
-- 확인된 실제 컬럼 구조:
--   parents.id                  = auth.uid()              (직접 소유)
--   pending_children.parent_id  → parents.id             (직접 소유)
--   parent_questions.child_id   → pending_children.id    (1단계)
--   chat_sessions.child_id      → pending_children.id    (1단계)
--   chat_messages.session_id    → chat_sessions.id       (service_role 전용 유지)
--   daily_reports.session_id    → chat_sessions.id       (2단계)
--   report_views.report_id      → daily_reports.id       (3단계)
--   weekly_summaries.child_id   → pending_children.id    (1단계)
--
-- 선행 조건: 이 파일은 자체적으로 ADD COLUMN IF NOT EXISTS를 포함하므로
--   20260609000000_auth_and_rls.sql 미실행 상태에서도 단독 실행 가능.
-- ================================================================

-- ── 1. parents 테이블 (없으면 생성) ──────────────────────────────
CREATE TABLE IF NOT EXISTS parents (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. pending_children.parent_id 컬럼 (없으면 추가) ─────────────
ALTER TABLE pending_children
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES parents(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_pending_children_parent_id
  ON pending_children(parent_id);

-- ── 3. 신규 가입 시 parents 행 자동 생성 트리거 ─────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.parents (id, email, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ================================================================
-- RLS 정책
-- ================================================================

-- ── parents ──────────────────────────────────────────────────────
ALTER TABLE parents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parents_select_own"  ON parents;
DROP POLICY IF EXISTS "parents_update_own"  ON parents;

-- 본인 행만 읽기·수정 허용
CREATE POLICY "parents_select_own"
  ON parents FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "parents_update_own"
  ON parents FOR UPDATE
  USING (id = auth.uid());

-- ── pending_children ─────────────────────────────────────────────
-- 연결: pending_children.parent_id = auth.uid()
ALTER TABLE pending_children ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parent_owns_child" ON pending_children;

CREATE POLICY "parent_owns_child"
  ON pending_children FOR ALL
  USING (
    auth.role() = 'service_role'
    OR parent_id = auth.uid()
    OR parent_id IS NULL          -- 마이그레이션 전 등록된 기존 데이터 허용
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR parent_id = auth.uid()
    OR parent_id IS NULL
  );

-- ── parent_questions ─────────────────────────────────────────────
-- 연결: child_id → pending_children.parent_id = auth.uid()
ALTER TABLE parent_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parent_crud_questions"  ON parent_questions;
DROP POLICY IF EXISTS "parent_owns_questions"  ON parent_questions;

CREATE POLICY "parent_owns_questions"
  ON parent_questions FOR ALL
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM pending_children pc
      WHERE pc.id = parent_questions.child_id
        AND (pc.parent_id = auth.uid() OR pc.parent_id IS NULL)
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM pending_children pc
      WHERE pc.id = parent_questions.child_id
        AND (pc.parent_id = auth.uid() OR pc.parent_id IS NULL)
    )
  );

-- ── chat_sessions ────────────────────────────────────────────────
-- Phase 1에서 RLS 없이 생성됨 → 지금 추가
-- 연결: child_id → pending_children.parent_id = auth.uid()
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parent_owns_chat_sessions" ON chat_sessions;

CREATE POLICY "parent_owns_chat_sessions"
  ON chat_sessions FOR ALL
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM pending_children pc
      WHERE pc.id = chat_sessions.child_id
        AND (pc.parent_id = auth.uid() OR pc.parent_id IS NULL)
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM pending_children pc
      WHERE pc.id = chat_sessions.child_id
        AND (pc.parent_id = auth.uid() OR pc.parent_id IS NULL)
    )
  );

-- ── chat_messages ─────────────────────────────────────────────────
-- 부모가 채팅 원문을 직접 읽지 못하도록 service_role 전용 유지
-- Phase 1에서 이미 적용됨 → 변경 없음
-- (기존: "system_only_chat_messages" FOR ALL USING (auth.role() = 'service_role'))

-- ── daily_reports ─────────────────────────────────────────────────
-- 연결: session_id → chat_sessions.child_id → pending_children.parent_id
-- 기존 정책 (authenticated OR service_role) → 본인 아이 데이터만으로 강화
ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parent_read_reports"      ON daily_reports;
DROP POLICY IF EXISTS "service_insert_reports"   ON daily_reports;
DROP POLICY IF EXISTS "service_update_reports"   ON daily_reports;

-- SELECT: 본인 아이의 대화 세션에서 생성된 리포트만
CREATE POLICY "parent_read_reports"
  ON daily_reports FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM chat_sessions cs
      JOIN pending_children pc ON pc.id = cs.child_id
      WHERE cs.id = daily_reports.session_id
        AND (pc.parent_id = auth.uid() OR pc.parent_id IS NULL)
    )
  );

-- INSERT / UPDATE: AI 서버(service_role)만 작성
CREATE POLICY "service_insert_reports"
  ON daily_reports FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_update_reports"
  ON daily_reports FOR UPDATE
  USING (auth.role() = 'service_role');

-- ── report_views ──────────────────────────────────────────────────
-- 연결: report_id → daily_reports.session_id → chat_sessions.child_id
-- 기존 정책 (authenticated INSERT only) → 본인 아이 리포트만으로 강화
ALTER TABLE report_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parent_insert_views"  ON report_views;
DROP POLICY IF EXISTS "parent_select_views"  ON report_views;

CREATE POLICY "parent_select_views"
  ON report_views FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM daily_reports dr
      JOIN chat_sessions cs ON cs.id = dr.session_id
      JOIN pending_children pc ON pc.id = cs.child_id
      WHERE dr.id = report_views.report_id
        AND (pc.parent_id = auth.uid() OR pc.parent_id IS NULL)
    )
  );

CREATE POLICY "parent_insert_views"
  ON report_views FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM daily_reports dr
      JOIN chat_sessions cs ON cs.id = dr.session_id
      JOIN pending_children pc ON pc.id = cs.child_id
      WHERE dr.id = report_views.report_id
        AND (pc.parent_id = auth.uid() OR pc.parent_id IS NULL)
    )
  );

-- ── weekly_summaries ──────────────────────────────────────────────
-- 연결: child_id → pending_children.parent_id = auth.uid()
ALTER TABLE weekly_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parent_read_weekly"    ON weekly_summaries;
DROP POLICY IF EXISTS "service_insert_weekly" ON weekly_summaries;
DROP POLICY IF EXISTS "service_update_weekly" ON weekly_summaries;

CREATE POLICY "parent_read_weekly"
  ON weekly_summaries FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM pending_children pc
      WHERE pc.id = weekly_summaries.child_id
        AND (pc.parent_id = auth.uid() OR pc.parent_id IS NULL)
    )
  );

CREATE POLICY "service_insert_weekly"
  ON weekly_summaries FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_update_weekly"
  ON weekly_summaries FOR UPDATE
  USING (auth.role() = 'service_role');

-- ================================================================
-- ※ profiles 테이블: id 컬럼이 auth.users.id와 FK로 연결되어 있지 않아
--   auth.uid() 기반 RLS 적용 불가. 현재 앱에서 미사용 상태.
-- ================================================================

-- ================================================================
-- 검증 쿼리 (RLS 적용 후 Supabase SQL Editor에서 별도 실행)
-- 로그인된 사용자 컨텍스트에서 실행하면 본인 데이터만 반환돼야 함.
-- ================================================================

/*
-- 1. 본인 소유 아이 목록
SELECT id, name, parent_id FROM pending_children;
-- 기대: parent_id = auth.uid() 인 행만 반환 (또는 parent_id IS NULL인 기존 행)

-- 2. 본인 아이에 등록된 질문
SELECT id, question_text, child_id FROM parent_questions;
-- 기대: 본인 아이 child_id에 속한 질문만 반환

-- 3. 본인 아이의 대화 세션
SELECT id, child_id, started_at FROM chat_sessions;
-- 기대: 본인 아이 child_id에 속한 세션만 반환

-- 4. 본인 아이 세션의 리포트
SELECT id, mood_score, session_id FROM daily_reports;
-- 기대: 본인 아이 세션에서 생성된 리포트만 반환

-- 5. 본인 리포트 열람 기록
SELECT id, report_id FROM report_views;
-- 기대: 본인 리포트에 대한 열람 기록만 반환

-- 6. 본인 아이의 주간 요약
SELECT id, week_start, child_id FROM weekly_summaries;
-- 기대: 본인 아이 child_id에 속한 주간 요약만 반환

-- 7. parents 본인 행
SELECT id, email FROM parents WHERE id = auth.uid();
-- 기대: 정확히 1행 반환 (로그인한 부모 본인)
*/
