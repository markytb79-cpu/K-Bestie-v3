-- ⚠️ 초안만 작성 — 실행 전 대표 승인 필수(하드룰: DB 실행 금지, SQL 생성만).
-- 신규 테이블(기존 테이블 변경 없음).
--
-- 용도: Vertex AI 전환 스위치 — 그룹A(리포트·요약)/B(미션 대화)/C(라이브 음성) 각각
--   AI Studio↔Vertex 프로바이더와 모델을 관리자가 /admin에서 전환할 수 있도록
--   설정값을 그룹별 1행으로 저장한다. 각 API 라우트가 호출 시점에 이 테이블을
--   조회해 provider/model을 결정한다(server-trust, 클라이언트 조작 불가).
-- ================================================================

CREATE TABLE provider_switch_settings (
  "group"     TEXT PRIMARY KEY CHECK ("group" IN ('A', 'B', 'C')),
  provider    TEXT NOT NULL CHECK (provider IN ('ai_studio', 'vertex')),
  model_id    TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT  -- 변경한 관리자 이메일(감사 로그용, ADMIN_EMAILS 화이트리스트 값)
);

-- 초기값: 전부 AI Studio 유지(기존 동작 무변화) — 그룹별 기존 ACTIVE_* 모델 ID와 동일하게.
INSERT INTO provider_switch_settings ("group", provider, model_id) VALUES
  ('A', 'ai_studio', 'gemma-4-31b-it'),
  ('B', 'ai_studio', 'gemini-flash-lite-latest'),
  ('C', 'ai_studio', 'gemini-3.1-flash-live-preview');

-- ── RLS: 앱 서버(service client)만 읽기/쓰기 가능. anon/authenticated 대상 정책 없음 ──
ALTER TABLE provider_switch_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "provider_switch_settings_select"
  ON provider_switch_settings FOR SELECT
  USING (auth.role() = 'service_role');

CREATE POLICY "provider_switch_settings_update"
  ON provider_switch_settings FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
