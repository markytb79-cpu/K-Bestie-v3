-- 초안 (DDL DRAFT ONLY) — 실행 금지, 대표 승인 후 대표가 직접 실행할 것
-- 목적: 주간 리포트에 "주말 활동 추천" 필드 저장
-- 관련: lib/batch/generateWeeklySummary.ts, app/api/_lib/prompts.ts (WEEKLY_REPORT_PROMPT_TEMPLATE)

ALTER TABLE weekly_summaries
  ADD COLUMN weekend_activity_recommendation TEXT NOT NULL DEFAULT '';

-- weekend_activity_recommendation:
--   아이 관심사·취향 기반 주말 활동 추천 (구체적 장소/활동, 1~2문장).
--   빠른요약/상세보기 두 탭 모두, 감정 등급과 무관하게 노출.
--   매주 토요일 06:00 KST 주간 요약 배치가 채움.
