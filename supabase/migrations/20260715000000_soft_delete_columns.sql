-- ⚠️ 초안만 작성 — 실행 전 대표 승인 필수(하드룰: DB 실행 금지, SQL 생성만).
-- 기존 테이블 컬럼 추가만(신규 테이블 없음) + 활성 데이터 필터링 뷰 신설.
--
-- 목적: 요금제별 보존기간(다운그레이드 등)을 초과한 데이터를 소프트삭제(deleted_at)로
--   표시해두고, 30일 유예 후 자동 파기 잡(별도 마이그레이션)에서 물리 삭제한다.
--   유예 기간 안에 유효 보존기간이 다시 늘어나면 deleted_at을 NULL로 되돌려 복구한다.
--
-- 파기 대상: chat_sessions(부모) / chat_messages / daily_reports / weekly_summaries — 4개.
-- safety_events는 관리자 전용 내부 안전 모니터링 데이터로 이 파기 정책에서 완전히 제외
--   (영구 보관) — 이 파일 및 관련 산출물 어디에도 safety_events는 등장하지 않는다.
--
-- 나이 판정 기준(앵커):
--   - 세션 스코프(chat_sessions/chat_messages/daily_reports): chat_sessions.started_at
--     (chat_sessions에는 created_at 컬럼이 존재하지 않음 — 20260609400000_family_clean_slate.sql
--      L106-114 참고. 어떤 SQL에도 chat_sessions.created_at을 참조하지 않는다.)
--   - weekly_summaries: 자기 자신의 week_start(주 시작일)
-- ================================================================

ALTER TABLE chat_sessions
  ADD COLUMN deleted_at TIMESTAMPTZ NULL;

ALTER TABLE chat_messages
  ADD COLUMN deleted_at TIMESTAMPTZ NULL;

ALTER TABLE daily_reports
  ADD COLUMN deleted_at TIMESTAMPTZ NULL;

ALTER TABLE weekly_summaries
  ADD COLUMN deleted_at TIMESTAMPTZ NULL;

-- 기존 행은 전부 NULL(활성) 유지 — 파기는 이후 다운그레이드 등 축소 이벤트 시점부터만 스탬프된다.

-- ── 활성 데이터 필터링 뷰 ──────────────────────────────────────
-- 세션 스코프 자식 테이블은 "자기 자신도 소프트삭제 안 됐고, 소속 세션도 소프트삭제 안 됨"을
-- 함께 확인해야 한다(세션 경계 일괄 스탬프이므로 정상 케이스라면 항상 같이 움직이지만,
-- 방어적으로 양쪽 다 체크).

CREATE VIEW active_chat_sessions AS
SELECT s.*
FROM chat_sessions s
WHERE s.deleted_at IS NULL;

CREATE VIEW active_chat_messages AS
SELECT m.*
FROM chat_messages m
JOIN chat_sessions s ON s.id = m.session_id
WHERE m.deleted_at IS NULL
  AND s.deleted_at IS NULL;

CREATE VIEW active_daily_reports AS
SELECT r.*
FROM daily_reports r
JOIN chat_sessions s ON s.id = r.session_id
WHERE r.deleted_at IS NULL
  AND s.deleted_at IS NULL;

CREATE VIEW active_weekly_summaries AS
SELECT w.*
FROM weekly_summaries w
WHERE w.deleted_at IS NULL;
