// 파기/복구 무결성 검증 쿼리 — Critic이 제시한 assert 술어를 그대로 SQL로 인코딩.
// 실행은 이 모듈의 책임이 아니다(이 파일 자체도 어떤 DB 명령도 호출하지 않는다) —
// 대표가 SQL Editor에서 직접 실행하거나, 향후 관측용 스크립트가 이 쿼리를 재사용한다.
// 세 쿼리 모두 "0"이 나와야 정상(무결성 위반 없음).

/** 스탬프 후: 세션별 부모(chat_sessions.deleted_at)/자식(chat_messages·daily_reports.deleted_at)
 *  스탬프 상태가 불일치하는 세션 수 — 부분 스탬프(고아 원인) 검출. 0이어야 정상. */
export const ORPHAN_PARTIAL_STAMP_QUERY = `
SELECT count(*) AS partial_stamp_session_count FROM (
  SELECT s.id
  FROM chat_sessions s
  LEFT JOIN chat_messages m ON m.session_id = s.id
  LEFT JOIN daily_reports r ON r.session_id = s.id
  GROUP BY s.id, s.deleted_at
  HAVING
    bool_or(m.deleted_at IS NOT NULL) <> bool_and(m.deleted_at IS NOT NULL)
    OR (s.deleted_at IS NOT NULL) <> COALESCE(bool_and(m.deleted_at IS NOT NULL), s.deleted_at IS NOT NULL)
    OR (s.deleted_at IS NOT NULL) <> COALESCE(bool_and(r.deleted_at IS NOT NULL), s.deleted_at IS NOT NULL)
) partial;
`.trim();

/** 물리 파기 후: chat_messages/daily_reports 중 존재하지 않는(삭제된) chat_sessions를
 *  가리키는 dangling session_id 수 — 0이어야 정상(고아 자식 없음). */
export const DANGLING_SESSION_ID_QUERY = `
SELECT
  (SELECT count(*) FROM chat_messages m WHERE NOT EXISTS (SELECT 1 FROM chat_sessions s WHERE s.id = m.session_id)) AS dangling_chat_messages,
  (SELECT count(*) FROM daily_reports r WHERE NOT EXISTS (SELECT 1 FROM chat_sessions s WHERE s.id = r.session_id)) AS dangling_daily_reports;
`.trim();

/** 물리 파기 후: 자식(chat_messages/daily_reports)이 전멸했는데 부모 chat_sessions만
 *  잔존하는 세션 수 — 0이어야 정상(고아 부모 없음). */
export const ORPHAN_PARENT_SESSION_QUERY = `
SELECT count(*) AS orphan_parent_session_count
FROM chat_sessions s
WHERE NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.session_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM daily_reports r WHERE r.session_id = s.id);
`.trim();

/** 복구 후: 동일 session_id 내 deleted_at NULL 행과 NOT NULL 행이 혼재하는 세션 수 —
 *  0이어야 정상(부분 복구 없음, 세션은 항상 통째로 복구/파기). */
export const PARTIAL_RESTORE_QUERY = `
SELECT count(*) AS partial_restore_session_count FROM (
  SELECT session_id
  FROM chat_messages
  GROUP BY session_id
  HAVING count(*) FILTER (WHERE deleted_at IS NULL) > 0
     AND count(*) FILTER (WHERE deleted_at IS NOT NULL) > 0
) partial;
`.trim();

/** weekly_summaries 잔존 0건: deleted_at < now()-30일인데 아직 물리 삭제되지 않은 행 수 —
 *  0이어야 정상(파기 Cron이 정상 동작 중이라면 유예 경과분은 이미 삭제됐어야 함). */
export const WEEKLY_STALE_REMNANT_QUERY = `
SELECT count(*) AS weekly_stale_remnant_count
FROM weekly_summaries
WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
`.trim();

/** safety_events negative test — 이 테이블은 파기 정책과 무관하게 영구 보관되므로,
 *  deleted_at 컬럼이 존재하면 안 된다(스키마 오염 검출용). */
export const SAFETY_EVENTS_NO_DELETED_AT_QUERY = `
SELECT count(*) AS safety_events_deleted_at_column_exists
FROM information_schema.columns
WHERE table_name = 'safety_events' AND column_name = 'deleted_at';
`.trim();
