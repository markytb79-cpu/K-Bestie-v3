-- 신규 컬럼 추가(기본값 포함) — 기존 행에 영향 없는 안전한 추가 작업.
-- 대표 승인(조건부: 위험작업 아니면 직접 실행)에 따라 서비스 계정으로 직접 실행함.
--
-- 목적: Tier3(Live) 아이가 설정 메뉴에서 고른 케이 목소리를 아이 단위로 저장.
-- 기본값 'Achernar' — 정식 목소리 선택 UI의 기본 선택지와 동일.

ALTER TABLE child_profiles
  ADD COLUMN live_voice_name TEXT NOT NULL DEFAULT 'Achernar';
