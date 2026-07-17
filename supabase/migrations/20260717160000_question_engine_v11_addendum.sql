-- DRAFT: 실행 전 사용자 승인 필요, 아직 미적용
-- 목적: '질문·대화 엔진' PR1.1 스키마 보완 마이그레이션 (세션 스코프 추가, 골드키 멱등성 보장, 질문 종료 사유 추가 및 주석 갱신)

-- 1. mission_question_history에 세션 ID(session_id) 추가
-- 기존 행에 대해 세션을 소급해 백필하는 것이 불가능하므로, NULL 허용(nullable)으로 추가합니다.
ALTER TABLE mission_question_history
  ADD COLUMN session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE;

COMMENT ON COLUMN mission_question_history.session_id IS '이 질문이 출제된 미션의 대화 세션 ID. 기존 행은 세션 소급이 불가능하므로 NULL 상태로 남겨둡니다.';

-- 2. mission_question_history에 질문 종료 사유(termination_reason) 추가
-- 미응답(NULL)인 미사용 질문이 왜 종료되었는지(COMPLETED 또는 SAFETY_PAUSED) 기록하기 위해 사용합니다.
ALTER TABLE mission_question_history
  ADD COLUMN termination_reason TEXT CHECK (termination_reason IN ('COMPLETED', 'SAFETY_PAUSED'));

COMMENT ON COLUMN mission_question_history.termination_reason IS '질문이 미응답(NULL) 상태에서 미션이 종료되었을 때의 사유 (COMPLETED: 10개 유효답변 달성으로 조기 종료, SAFETY_PAUSED: 안전 신호 감지로 중단)';

-- 3. gold_key_ledger에 미션 세션 및 보상 유형 컬럼 추가 및 복합 유니크 제약 추가
-- mission_id와 reward_type을 추가하여 미션 보상 지급 시 멱등성을 보장합니다.
ALTER TABLE gold_key_ledger
  ADD COLUMN mission_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
  ADD COLUMN reward_type TEXT;

COMMENT ON COLUMN gold_key_ledger.mission_id IS '보상이 지급된 미션의 대화 세션 ID (chat_sessions.id)';
COMMENT ON COLUMN gold_key_ledger.reward_type IS '보상 지급 유형 (예: mission_complete, attendance 등)';

-- (child_id, mission_id, reward_type) 복합 유니크 인덱스 생성
-- mission_id가 NULL인 기존 보상이나 비질문엔진 보상은 유니크 제약에서 제외되도록 partial index로 생성합니다.
CREATE UNIQUE INDEX uidx_gold_key_ledger_mission_reward
  ON gold_key_ledger (child_id, mission_id, reward_type)
  WHERE mission_id IS NOT NULL;

-- 4. answer_status / answer_classification 컬럼 코멘트 갱신 (권위 재정의)
COMMENT ON COLUMN mission_question_history.answer_status IS '레거시 상태값(answered/skipped/refused). UI 하위호환을 위해 계속 기록되지만 더 이상 진행률 판정의 권위값이 아니다.';
COMMENT ON COLUMN mission_question_history.answer_classification IS '질문 엔진 V2의 최종 판정 source of truth(VALID/PARTIAL/REFUSAL/NO_RESPONSE/SAFETY_SIGNAL). progress_awarded와 함께 서버 진행률 계산의 기준이 된다.';
