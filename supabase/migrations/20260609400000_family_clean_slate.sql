-- ================================================================
-- 내친구 케이 v3 — 가족 모델 대마이그레이션 (클린 슬레이트)
-- 실행: scripts/run-migration.js 또는 Supabase SQL Editor
-- ================================================================

-- ── 0. 기존 테이블 전체 삭제 (의존성 역순) ──────────────────────
DROP TABLE IF EXISTS report_views       CASCADE;
DROP TABLE IF EXISTS weekly_summaries   CASCADE;
DROP TABLE IF EXISTS parent_questions   CASCADE;
DROP TABLE IF EXISTS daily_reports      CASCADE;
DROP TABLE IF EXISTS chat_messages      CASCADE;
DROP TABLE IF EXISTS chat_sessions      CASCADE;
DROP TABLE IF EXISTS child_invite_codes CASCADE;
DROP TABLE IF EXISTS parent_invitations CASCADE;
DROP TABLE IF EXISTS child_profiles     CASCADE;
DROP TABLE IF EXISTS family_members     CASCADE;
DROP TABLE IF EXISTS families           CASCADE;
DROP TABLE IF EXISTS pending_children   CASCADE;
DROP TABLE IF EXISTS parents            CASCADE;
DROP TABLE IF EXISTS profiles           CASCADE;

DROP TRIGGER  IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- ================================================================
-- 1. CORE 테이블
-- ================================================================

-- ── parents (auth.users ↔ 부모 프로필) ───────────────────────
CREATE TABLE parents (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── families ─────────────────────────────────────────────────
CREATE TABLE families (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── family_members ───────────────────────────────────────────
-- 부모·아이 모두 auth.users 계정을 가지며 이 테이블로 가족에 연결
CREATE TABLE family_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id  UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,  -- 아이 미가입 시 NULL
  role       TEXT NOT NULL CHECK (role IN ('owner_parent', 'parent', 'child')),
  joined_at  TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_id, user_id)
);

-- ── child_profiles (pending_children 완전 대체) ───────────────
-- 부모가 아이를 추가할 때 생성; 아이가 코드로 가입하면 member_id 연결됨
CREATE TABLE child_profiles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id  UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_id  UUID REFERENCES family_members(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  grade      TEXT NOT NULL,
  interests  TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ================================================================
-- 2. 초대 테이블
-- ================================================================

-- ── parent_invitations (이메일 초대 링크) ─────────────────────
CREATE TABLE parent_invitations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  token         TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  invited_by    UUID NOT NULL REFERENCES auth.users(id),
  role          TEXT NOT NULL DEFAULT 'parent' CHECK (role IN ('parent')),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '7 days',
  accepted_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── child_invite_codes (아이 가입용 코드) ─────────────────────
-- 만료 기간 30일, 1회 사용, 법정대리인 동의 기록 포함
CREATE TABLE child_invite_codes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id           UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  child_profile_id    UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  code                TEXT NOT NULL UNIQUE DEFAULT upper(encode(gen_random_bytes(4), 'hex')),
  created_by          UUID NOT NULL REFERENCES auth.users(id),
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '30 days',
  used_at             TIMESTAMPTZ,
  used_by_user_id     UUID REFERENCES auth.users(id),
  guardian_consent    BOOLEAN NOT NULL DEFAULT false,
  guardian_consent_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ================================================================
-- 3. 대화/리포트 테이블 (FK: child_profiles 기준)
-- ================================================================

CREATE TABLE chat_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id     UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ,
  turn_count   INTEGER NOT NULL DEFAULT 0,
  session_type TEXT NOT NULL DEFAULT 'free' CHECK (session_type IN ('mission', 'free')),
  mission_id   TEXT
);

CREATE TABLE chat_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('child', 'k')),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE daily_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  summary_line TEXT NOT NULL,
  mood_score   INTEGER NOT NULL CHECK (mood_score BETWEEN 1 AND 10),
  emotion_tags TEXT[] NOT NULL DEFAULT '{}',
  parent_guide TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE parent_questions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id          UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  question_text     TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT '대기중' CHECK (status IN ('대기중', '전달됨', '중지됨')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_count   INTEGER NOT NULL DEFAULT 0,
  last_delivered_at TIMESTAMPTZ
);

CREATE TABLE report_views (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE weekly_summaries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id     UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  week_start   DATE NOT NULL,
  week_end     DATE NOT NULL,
  summary_text TEXT NOT NULL DEFAULT '',
  mood_average NUMERIC(4,2),
  highlights   TEXT[] NOT NULL DEFAULT '{}',
  parent_guide TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (child_id, week_start)
);

-- ================================================================
-- 4. 인덱스
-- ================================================================

CREATE INDEX idx_family_members_family_id ON family_members(family_id);
CREATE INDEX idx_family_members_user_id   ON family_members(user_id);
CREATE INDEX idx_child_profiles_family_id ON child_profiles(family_id);
CREATE INDEX idx_child_profiles_member_id ON child_profiles(member_id);
CREATE INDEX idx_parent_inv_token         ON parent_invitations(token);
CREATE INDEX idx_parent_inv_family        ON parent_invitations(family_id);
CREATE INDEX idx_child_inv_code           ON child_invite_codes(code);
CREATE INDEX idx_child_inv_child          ON child_invite_codes(child_profile_id);
CREATE INDEX idx_chat_sessions_child_id   ON chat_sessions(child_id);
CREATE INDEX idx_parent_questions_child   ON parent_questions(child_id);
CREATE INDEX idx_weekly_summaries_child   ON weekly_summaries(child_id);

-- ================================================================
-- 5. 트리거: 신규 가입 시 parents 행 자동 생성
-- ================================================================

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

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ================================================================
-- 6. RLS 정책
-- ================================================================

-- ── parents ──────────────────────────────────────────────────
ALTER TABLE parents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parents_select_own"
  ON parents FOR SELECT
  USING (id = auth.uid() OR auth.role() = 'service_role');

CREATE POLICY "parents_insert_self"
  ON parents FOR INSERT
  WITH CHECK (id = auth.uid() OR auth.role() = 'service_role');

CREATE POLICY "parents_update_own"
  ON parents FOR UPDATE
  USING (id = auth.uid() OR auth.role() = 'service_role');

-- ── families ─────────────────────────────────────────────────
ALTER TABLE families ENABLE ROW LEVEL SECURITY;

CREATE POLICY "families_select_member"
  ON families FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.family_id = families.id AND fm.user_id = auth.uid()
    )
  );

CREATE POLICY "families_insert_auth"
  ON families FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND created_by = auth.uid());

CREATE POLICY "families_update_owner"
  ON families FOR UPDATE
  USING (created_by = auth.uid() OR auth.role() = 'service_role');

-- ── family_members ───────────────────────────────────────────
ALTER TABLE family_members ENABLE ROW LEVEL SECURITY;

-- 자기 참조 EXISTS 제거 — PostgreSQL 무한 재귀 방지
CREATE POLICY "family_members_select"
  ON family_members FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR user_id = auth.uid()
  );

CREATE POLICY "family_members_insert"
  ON family_members FOR INSERT
  WITH CHECK (auth.role() = 'service_role' OR auth.uid() IS NOT NULL);

CREATE POLICY "family_members_update"
  ON family_members FOR UPDATE
  USING (auth.role() = 'service_role');

-- ── child_profiles ───────────────────────────────────────────
ALTER TABLE child_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "child_profiles_select"
  ON child_profiles FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.family_id = child_profiles.family_id AND fm.user_id = auth.uid()
    )
  );

CREATE POLICY "child_profiles_insert"
  ON child_profiles FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.family_id = child_profiles.family_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );

CREATE POLICY "child_profiles_update"
  ON child_profiles FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.family_id = child_profiles.family_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner_parent', 'parent')
    )
  );

-- ── parent_invitations ───────────────────────────────────────
ALTER TABLE parent_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parent_inv_select"
  ON parent_invitations FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR invited_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.family_id = parent_invitations.family_id AND fm.user_id = auth.uid()
    )
  );

CREATE POLICY "parent_inv_insert"
  ON parent_invitations FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      invited_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM family_members fm
        WHERE fm.family_id = parent_invitations.family_id
          AND fm.user_id = auth.uid()
          AND fm.role IN ('owner_parent', 'parent')
      )
    )
  );

CREATE POLICY "parent_inv_update"
  ON parent_invitations FOR UPDATE
  USING (auth.role() = 'service_role');

-- ── child_invite_codes ───────────────────────────────────────
ALTER TABLE child_invite_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "child_inv_select"
  ON child_invite_codes FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.family_id = child_invite_codes.family_id AND fm.user_id = auth.uid()
    )
  );

CREATE POLICY "child_inv_insert"
  ON child_invite_codes FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      created_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM family_members fm
        WHERE fm.family_id = child_invite_codes.family_id
          AND fm.user_id = auth.uid()
          AND fm.role IN ('owner_parent', 'parent')
      )
    )
  );

CREATE POLICY "child_inv_update"
  ON child_invite_codes FOR UPDATE
  USING (auth.role() = 'service_role');

-- ── chat_sessions ────────────────────────────────────────────
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_sessions_access"
  ON chat_sessions FOR ALL
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = chat_sessions.child_id AND fm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM child_profiles cp
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cp.id = chat_sessions.child_id AND fm.user_id = auth.uid()
    )
  );

-- ── chat_messages ─────────────────────────────── (프라이버시 원칙: service_role 전용)
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_messages_service_only"
  ON chat_messages FOR ALL
  USING (auth.role() = 'service_role');

-- ── daily_reports ─────────────────────────────────────────────
ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;

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

CREATE POLICY "daily_reports_insert"
  ON daily_reports FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "daily_reports_update"
  ON daily_reports FOR UPDATE
  USING (auth.role() = 'service_role');

-- ── parent_questions ─────────────────────────────────────────
ALTER TABLE parent_questions ENABLE ROW LEVEL SECURITY;

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

-- ── report_views ──────────────────────────────────────────────
ALTER TABLE report_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "report_views_access"
  ON report_views FOR ALL
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM daily_reports dr
      JOIN chat_sessions cs ON cs.id = dr.session_id
      JOIN child_profiles cp ON cp.id = cs.child_id
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE dr.id = report_views.report_id AND fm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM daily_reports dr
      JOIN chat_sessions cs ON cs.id = dr.session_id
      JOIN child_profiles cp ON cp.id = cs.child_id
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE dr.id = report_views.report_id AND fm.user_id = auth.uid()
    )
  );

-- ── weekly_summaries ──────────────────────────────────────────
ALTER TABLE weekly_summaries ENABLE ROW LEVEL SECURITY;

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

CREATE POLICY "weekly_summaries_insert"
  ON weekly_summaries FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "weekly_summaries_update"
  ON weekly_summaries FOR UPDATE
  USING (auth.role() = 'service_role');
