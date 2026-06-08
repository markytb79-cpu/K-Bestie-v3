-- ================================================================
-- 내친구 케이 v3 - Phase 1 DB 스키마
-- ================================================================

CREATE TABLE pending_children (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  grade       TEXT NOT NULL,
  interests   TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id    UUID NOT NULL REFERENCES pending_children(id),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ,
  turn_count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES chat_sessions(id),
  role        TEXT NOT NULL CHECK (role IN ('child', 'k')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE daily_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES chat_sessions(id),
  summary_line  TEXT NOT NULL,
  mood_score    INTEGER NOT NULL CHECK (mood_score BETWEEN 1 AND 10),
  emotion_tags  TEXT[] NOT NULL DEFAULT '{}',
  parent_guide  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE parent_questions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id          UUID NOT NULL REFERENCES pending_children(id),
  question_text     TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT '대기중'
                      CHECK (status IN ('대기중', '전달됨', '중지됨')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_count   INTEGER NOT NULL DEFAULT 0,
  last_delivered_at TIMESTAMPTZ
);

CREATE TABLE report_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   UUID NOT NULL REFERENCES daily_reports(id),
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "system_only_chat_messages"
  ON chat_messages FOR ALL
  USING (auth.role() = 'service_role');

ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "parent_read_reports"
  ON daily_reports FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

ALTER TABLE parent_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "parent_crud_questions"
  ON parent_questions FOR ALL
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

ALTER TABLE report_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "parent_insert_views"
  ON report_views FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'service_role');
