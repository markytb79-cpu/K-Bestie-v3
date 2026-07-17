-- DRAFT: 실행 전 사용자 승인 필요, 아직 미적용
-- 목적: 20260717150200_question_engine_new_tables.sql 에 대한 롤백

DROP TABLE IF EXISTS question_review_history;
DROP TABLE IF EXISTS evidence_card_links;
DROP TABLE IF EXISTS answer_evidence;
DROP TABLE IF EXISTS question_variants;
