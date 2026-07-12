-- [APPLIED] 대표가 Supabase SQL Editor에서 직접 실행 완료(실제 DB에 safety_events 테이블 존재 확인).
-- 자유대화 규칙 기반 안전 이벤트 로그 (부모 알림용) — 신규 테이블, 기존 13개 승인 테이블 변경 없음
-- ================================================================

CREATE TABLE safety_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  subcategory  TEXT NOT NULL CHECK (subcategory IN ('violence', 'self_harm', 'threat', 'inappropriate_contact')),
  child_text   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  viewed_at    TIMESTAMPTZ
);

CREATE INDEX idx_safety_events_session ON safety_events(session_id);
CREATE INDEX idx_safety_events_created ON safety_events(created_at);

-- ── RLS: chat_messages와 동일한 프라이버시 원칙 + daily_reports와 동일한 부모 조회 경로 ──
-- 쓰기: service_role 전용(앱 서버가 service client로만 insert).
-- 읽기: chat_sessions → child_profiles → family_members 경로로 자기 가족 자녀 것만 조회 가능.
ALTER TABLE safety_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "safety_events_select"
  ON safety_events FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM chat_sessions cs
      JOIN child_profiles cp ON cp.id = cs.child_id
      JOIN family_members fm ON fm.family_id = cp.family_id
      WHERE cs.id = safety_events.session_id AND fm.user_id = auth.uid()
    )
  );

CREATE POLICY "safety_events_insert"
  ON safety_events FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "safety_events_update"
  ON safety_events FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- update 정책은 향후 "부모가 확인함(viewed_at)" 처리 기능을 붙일 때 service_role 경유 API로만 갱신하도록 열어둔 것.
-- 부모 클라이언트가 직접 UPDATE하는 경로는 없다(현재는 SELECT만 노출).
