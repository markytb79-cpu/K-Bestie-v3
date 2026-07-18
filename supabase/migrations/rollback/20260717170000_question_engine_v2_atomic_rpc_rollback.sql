-- DRAFT: 실행 전 사용자 승인 필요, 아직 미적용
-- 롤백: record_v2_mission_answer 및 record_v2_safety_pause RPC 제거

DROP FUNCTION IF EXISTS record_v2_mission_answer(UUID, UUID, UUID, TEXT, TEXT, INT, TEXT);
DROP FUNCTION IF EXISTS record_v2_safety_pause(UUID, UUID, UUID, TEXT, TEXT);
