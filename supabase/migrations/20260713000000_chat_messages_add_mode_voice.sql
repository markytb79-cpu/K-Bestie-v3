-- 관리자 대시보드 Phase 1: chat_messages에 대화 모드/음성 모드 메타데이터 추가
-- NULL 허용 컬럼만 추가 — 기존 행/컬럼에는 영향 없음 (추가 전용)
-- ================================================================

ALTER TABLE chat_messages ADD COLUMN mode TEXT NULL CHECK (mode IN ('mission', 'free'));
ALTER TABLE chat_messages ADD COLUMN voice_mode TEXT NULL CHECK (voice_mode IN ('stt_tts', 'live'));
