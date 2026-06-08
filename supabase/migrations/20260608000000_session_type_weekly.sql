-- ================================================================
-- chat_sessions: session_type / mission_id 컬럼 추가
-- ================================================================

ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS session_type TEXT NOT NULL DEFAULT 'free'
    CHECK (session_type IN ('mission', 'free')),
  ADD COLUMN IF NOT EXISTS mission_id   TEXT;

-- ================================================================
-- weekly_summaries: 주간 요약 테이블
-- ================================================================

CREATE TABLE IF NOT EXISTS weekly_summaries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id      UUID NOT NULL REFERENCES pending_children(id),
  week_start    DATE NOT NULL,   -- 해당 주 월요일
  week_end      DATE NOT NULL,   -- 해당 주 일요일
  summary_text  TEXT NOT NULL DEFAULT '',
  mood_average  NUMERIC(4, 2),
  highlights    TEXT[] NOT NULL DEFAULT '{}',
  parent_guide  TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (child_id, week_start)
);

ALTER TABLE weekly_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "parent_read_weekly"
  ON weekly_summaries FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');
