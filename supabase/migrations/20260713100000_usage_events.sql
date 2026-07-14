-- 관리자 대시보드 Phase 1: 사용량/비용 추적용 usage_events 테이블 (신규 테이블, 기존 테이블 변경 없음)
-- 용도: STT/TTS/실시간 음성/LLM 호출 단위로 사용량과 추정 비용(KRW)을 기록.
--   live_audio는 'start' 시점에 ended_at=NULL로 insert 후, 종료 시 duration_sec/ended_at을 update.
-- ================================================================

CREATE TABLE usage_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id      UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  tier          INT,
  voice_mode    TEXT,
  kind          TEXT NOT NULL CHECK (kind IN ('stt', 'tts', 'live_audio', 'llm')),
  duration_sec  NUMERIC,
  char_count    INT,
  token_in      INT,
  token_out     INT,
  est_cost_krw  NUMERIC,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ
);

CREATE INDEX idx_usage_events_child ON usage_events(child_id);
CREATE INDEX idx_usage_events_created ON usage_events(created_at);
CREATE INDEX idx_usage_events_kind ON usage_events(kind);

-- ── RLS: 앱 서버(service client)만 읽기/쓰기 가능. anon/authenticated 대상 정책 없음 ──
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_events_select"
  ON usage_events FOR SELECT
  USING (auth.role() = 'service_role');

CREATE POLICY "usage_events_insert"
  ON usage_events FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "usage_events_update"
  ON usage_events FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
