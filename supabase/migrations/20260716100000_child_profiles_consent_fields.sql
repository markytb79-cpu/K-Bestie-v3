-- 초안 (DDL DRAFT ONLY) — 실행 금지, 대표 승인 후 대표가 SQL Editor에서 직접 실행할 것
-- 배경: PRD 점검(2026-07-15)에서 발견 — app/api/families/[id]/children/route.ts와
--   app/api/families/[id]/members/route.ts가 guardian_consent를 요청 검증(게이트)에만 쓰고
--   실제로는 child_profiles에 저장하지 않고 있었다(child_invite_codes 테이블에만 있던 컬럼을
--   아이디+비밀번호 직접 발급 플로우에서는 전혀 쓰지 않았음 — 두 플로우가 분리되며 생긴 누락).
--
-- 목적: child_profiles에 동의 여부/시각/문서버전/철회시각을 직접 저장해서, 실제로 쓰이는
--   아이디+비밀번호 발급 플로우에서도 동의 기록이 남게 한다. 문서 버전은
--   lib/plan/consentDocument.ts의 CONSENT_DOCUMENT_VERSION과 대응된다.

ALTER TABLE child_profiles
  ADD COLUMN guardian_consent            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN guardian_consent_at         TIMESTAMPTZ,
  ADD COLUMN guardian_consent_version    TEXT,
  ADD COLUMN guardian_consent_withdrawn_at TIMESTAMPTZ;

-- 기존 행(이미 등록된 아이들)은 guardian_consent=false로 시작한다 — 실제로 동의를 받았는지
-- 소급 확인할 방법이 없으므로 값을 임의로 true로 채우지 않는다(과잉 추정 금지).
-- 필요하면 대표가 개별 확인 후 수동으로 백필할 것:
--   UPDATE child_profiles SET guardian_consent = true, guardian_consent_at = created_at,
--     guardian_consent_version = '<확인된 시점 버전>' WHERE id IN (...);
