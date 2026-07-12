-- [DRAFT — 미실행] 승인 후 대표가 SQL Editor에서 직접 실행할 것.
-- 실제 DB 확인 결과(2026-07-12): safety_events_subcategory_check 제약에 'neglect'가 아직 없음.
-- 미실행 상태에서도 lib/freeChatReactions.ts가 neglect로 분류하면 safety_events insert가
-- CHECK 제약 위반으로 실패하지만, 해당 실패는 에러 로그만 남기고 앱은 정상 동작한다(계획된 폴백).
--
-- safety_events.subcategory에 'neglect'(방임) 값 추가 — 세분화 검토 요청 반영
-- 대상 테이블은 이번에 신규 생성한 safety_events 하나뿐(기존 13개 승인 테이블 무관)
-- 실행 전제조건: 20260712100000_safety_events.sql 이 먼저 적용되어 있어야 함(이미 적용됨)
-- ================================================================

ALTER TABLE safety_events DROP CONSTRAINT IF EXISTS safety_events_subcategory_check;
ALTER TABLE safety_events ADD CONSTRAINT safety_events_subcategory_check
  CHECK (subcategory IN ('violence', 'self_harm', 'threat', 'inappropriate_contact', 'neglect'));
