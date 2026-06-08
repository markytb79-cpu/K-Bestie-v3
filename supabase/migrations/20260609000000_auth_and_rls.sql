-- ================================================================
-- 내친구 케이 v3 — 인증(Auth) 및 RLS 강화 마이그레이션
-- 실행 방법: Supabase 대시보드 → SQL Editor 에서 붙여넣기 후 실행
-- ※ 실제 실행은 대표님이 직접 진행해 주세요.
-- ================================================================

-- ── 1. parents 테이블 (auth.users 연결) ──────────────────────────
CREATE TABLE IF NOT EXISTS parents (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. pending_children 에 parent_id FK 추가 ─────────────────────
ALTER TABLE pending_children
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES parents(id) ON DELETE CASCADE;

-- ── 3. 인덱스 ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pending_children_parent_id
  ON pending_children(parent_id);

CREATE INDEX IF NOT EXISTS idx_parent_questions_child_id
  ON parent_questions(child_id);

CREATE INDEX IF NOT EXISTS idx_weekly_summaries_child_id
  ON weekly_summaries(child_id);

-- ── 4. parents RLS ───────────────────────────────────────────────
ALTER TABLE parents ENABLE ROW LEVEL SECURITY;

-- 본인 행만 읽기/수정 허용
CREATE POLICY "parents_select_own"
  ON parents FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "parents_update_own"
  ON parents FOR UPDATE
  USING (id = auth.uid());

-- ── 5. pending_children RLS 업데이트 ────────────────────────────
ALTER TABLE pending_children ENABLE ROW LEVEL SECURITY;

-- 기존 약한 정책 제거
DROP POLICY IF EXISTS "parent_owns_child" ON pending_children;

-- 부모 소유 + 기존 데모 데이터(parent_id IS NULL) + service_role 허용
CREATE POLICY "parent_owns_child"
  ON pending_children FOR ALL
  USING (
    parent_id = auth.uid()
    OR parent_id IS NULL
    OR auth.role() = 'service_role'
  )
  WITH CHECK (
    parent_id = auth.uid()
    OR parent_id IS NULL
    OR auth.role() = 'service_role'
  );

-- ── 6. parent_questions RLS 강화 (부모→아이 체인) ────────────────
ALTER TABLE parent_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parent_crud_questions" ON parent_questions;
DROP POLICY IF EXISTS "parent_owns_questions"  ON parent_questions;

CREATE POLICY "parent_owns_questions"
  ON parent_questions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM pending_children c
      WHERE c.id = parent_questions.child_id
        AND (
          c.parent_id = auth.uid()
          OR c.parent_id IS NULL
          OR auth.role() = 'service_role'
        )
    )
  );

-- ── 7. chat_messages 프라이버시 정책 유지 ────────────────────────
-- 기존: service_role 전용 — 변경 없음 (부모 SELECT 차단 유지)

-- ── 8. weekly_summaries RLS 강화 ─────────────────────────────────
DROP POLICY IF EXISTS "parent_read_weekly" ON weekly_summaries;

CREATE POLICY "parent_read_weekly"
  ON weekly_summaries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pending_children c
      WHERE c.id = weekly_summaries.child_id
        AND (c.parent_id = auth.uid() OR c.parent_id IS NULL)
    )
    OR auth.role() = 'service_role'
  );

-- ── 9. 신규 가입 시 parents 행 자동 생성 트리거 ───────────────────
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
-- 완료 후 확인 쿼리 (별도로 실행)
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name IN ('parents', 'pending_children');
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'pending_children' AND column_name = 'parent_id';
-- ================================================================
