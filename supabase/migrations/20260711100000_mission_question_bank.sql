-- 초안 (DDL DRAFT ONLY) — 실행 금지, 대표 승인 후 대표가 직접 실행할 것
-- 목적: DB 기반 미션 질문뱅크 + 아이별 출제이력 + 미션 진행상태(게이지)
-- 관련: feat/family-backend 미션 로직 백엔드 (mission_questions / mission_question_history / mission_progress)
-- 참고: chat_sessions.session_type('mission'|'free') 은 20260608000000_session_type_weekly.sql 에서 이미 추가됨

-- ================================================================
-- mission_questions: 질문뱅크 (학년별 최대 ~1000+ 확장 가능)
--   - 질문 문항은 코드/프롬프트에 하드코딩하지 않고 전부 이 테이블에 저장
--   - question_text 는 이번 단계에서 더미로 채움 (별도 페르소나AI가 추후 실제 문항 작성)
-- ================================================================
CREATE TABLE mission_questions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_text       TEXT NOT NULL DEFAULT '',          -- 더미/플레이스홀더, 추후 페르소나AI가 채움
  applicable_grades   INT[] NOT NULL DEFAULT '{}',        -- 적용 학년 (예: {3,4} = 초3,초4)
  cycle_type          TEXT NOT NULL
                        CHECK (cycle_type IN ('onboarding', 'always', 'weekly', 'monthly', 'quarterly')),
  dashboard_area_tag  TEXT NOT NULL
                        CHECK (dashboard_area_tag IN (
                          'school_life', 'peer_relations', 'emotion', 'interests',
                          'study_concerns', 'digital_interests', 'future_dreams', 'recurring_stories'
                        )),
  round_type          TEXT NOT NULL
                        CHECK (round_type IN ('round1_day', 'round2_night', 'common')),
  is_active           BOOLEAN NOT NULL DEFAULT true,       -- 삭제 대신 비활성화(재활용 가능)
  origin_question_id  UUID REFERENCES mission_questions(id), -- 원본추적 (복제/파생 출처, nullable self-ref)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mission_questions_active ON mission_questions (is_active);
CREATE INDEX idx_mission_questions_round  ON mission_questions (round_type);
CREATE INDEX idx_mission_questions_cycle  ON mission_questions (cycle_type);

-- ================================================================
-- mission_question_history: 아이별 출제이력 (주기 판단 · 온보딩 소진 추적)
-- ================================================================
CREATE TABLE mission_question_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id      UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  question_id   UUID NOT NULL REFERENCES mission_questions(id),
  asked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  answer_status TEXT CHECK (answer_status IN ('answered', 'skipped', 'refused'))  -- NULL 허용 (출제만 되고 미응답)
);

CREATE INDEX idx_mqh_child_question ON mission_question_history (child_id, question_id);
CREATE INDEX idx_mqh_child_asked    ON mission_question_history (child_id, asked_at);

-- ================================================================
-- mission_progress: 미션 세션별 진행상태 (게이지 0~5, 질문별 상태)
--   - session_id = chat_sessions(id) (session_type='mission' 세션만)
--   - question_ids: 이번 미션 8개 질문 순서 (앞 5개 = 필수, 뒤 3개 = 예비)
--   - question_states: { "<question_id>": "pending|answered|skipped|refused" }
-- ================================================================
CREATE TABLE mission_progress (
  session_id          UUID PRIMARY KEY REFERENCES chat_sessions(id),
  valid_answer_count  INT NOT NULL DEFAULT 0,              -- 유효답변 수 (게이지 0~5)
  question_ids        UUID[] NOT NULL DEFAULT '{}',        -- 8개 질문 순서 (앞5=필수, 뒤3=예비)
  question_states     JSONB NOT NULL DEFAULT '{}'::jsonb,  -- question_id -> 상태
  round_type          TEXT NOT NULL
                        CHECK (round_type IN ('round1_day', 'round2_night', 'common')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ================================================================
-- RLS: service_role 전체 접근, authenticated(부모) 는 read 정도만
-- (기존 파일 패턴과 일관: daily_reports / weekly_summaries 참고)
-- ================================================================
ALTER TABLE mission_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all_mission_questions"
  ON mission_questions FOR ALL
  USING (auth.role() = 'service_role');
CREATE POLICY "parent_read_mission_questions"
  ON mission_questions FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

ALTER TABLE mission_question_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all_mqh"
  ON mission_question_history FOR ALL
  USING (auth.role() = 'service_role');
CREATE POLICY "parent_read_mqh"
  ON mission_question_history FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

ALTER TABLE mission_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all_mission_progress"
  ON mission_progress FOR ALL
  USING (auth.role() = 'service_role');
CREATE POLICY "parent_read_mission_progress"
  ON mission_progress FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- ================================================================
-- 더미 시드 데이터 (question_text 는 플레이스홀더, 추후 교체)
--   각 cycle_type / round_type 조합 최소 1개씩
-- ================================================================
INSERT INTO mission_questions (question_text, applicable_grades, cycle_type, dashboard_area_tag, round_type) VALUES
  -- onboarding (친해지기, 첫 1주간 소진)
  ('(더미) 네 이름의 뜻이 궁금해! 누가 지어줬어?',        '{1,2,3,4,5,6}', 'onboarding', 'interests',        'common'),
  ('(더미) 요즘 제일 좋아하는 게 뭐야?',                  '{1,2,3,4,5,6}', 'onboarding', 'interests',        'common'),
  -- always (상시 기분체크 — 매 미션 필수 포함)
  ('(더미) 오늘 기분은 어때? 색깔로 말하면 무슨 색?',      '{1,2,3,4,5,6}', 'always',     'emotion',          'common'),
  ('(더미) 지금 마음속에 어떤 날씨가 떠올라?',            '{1,2,3,4,5,6}', 'always',     'emotion',          'round2_night'),
  -- round1_day (낮/학교)
  ('(더미) 학교에서 오늘 무슨 일 있었어?',                '{3,4,5,6}',     'always',     'school_life',      'round1_day'),
  ('(더미) 오늘 친구랑 뭐 하고 놀았어?',                  '{1,2,3,4}',     'weekly',     'peer_relations',   'round1_day'),
  ('(더미) 요즘 학원이나 공부는 어때?',                   '{4,5,6}',       'weekly',     'study_concerns',   'round1_day'),
  -- round2_night (밤/감정)
  ('(더미) 오늘 하루 중 가장 기억에 남는 순간은?',         '{1,2,3,4,5,6}', 'always',     'recurring_stories','round2_night'),
  ('(더미) 요즘 유튜브나 게임 뭐 보고 있어?',             '{3,4,5,6}',     'monthly',    'digital_interests','round2_night'),
  -- 주기형 예시 (monthly / quarterly)
  ('(더미) 커서 뭐가 되고 싶어? 요즘 생각은 어때?',        '{4,5,6}',       'monthly',    'future_dreams',    'common'),
  ('(더미) 요즘 새로 관심 생긴 게 있어?',                 '{1,2,3,4,5,6}', 'quarterly',  'interests',        'common');
