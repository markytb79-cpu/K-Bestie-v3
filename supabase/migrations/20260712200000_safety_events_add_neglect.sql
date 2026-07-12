-- [APPLIED 2026-07-12] 대표가 Supabase SQL Editor에서 직접 실행 완료.
-- 실행 후 재확인: safety_events_subcategory_check 제약에 'neglect' 포함 5개 값 확인됨.
--
-- safety_events.subcategory에 'neglect'(방임) 값 추가 — 세분화 검토 요청 반영
-- 대상 테이블은 이번에 신규 생성한 safety_events 하나뿐(기존 13개 승인 테이블 무관)
-- 실행 전제조건: 20260712100000_safety_events.sql 이 먼저 적용되어 있어야 함(이미 적용됨)
-- ================================================================

ALTER TABLE safety_events DROP CONSTRAINT IF EXISTS safety_events_subcategory_check;
ALTER TABLE safety_events ADD CONSTRAINT safety_events_subcategory_check
  CHECK (subcategory IN ('violence', 'self_harm', 'threat', 'inappropriate_contact', 'neglect'));
