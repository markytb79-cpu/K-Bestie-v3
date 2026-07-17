-- DRAFT: 실행 전 사용자 승인 필요, 아직 미적용
-- 목적: '질문·대화 엔진' 기능에 필요한 신규 테이블 생성 (PR1)

-- 1. question_variants 테이블 생성
CREATE TABLE question_variants (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_group_id     UUID NOT NULL REFERENCES mission_questions(id) ON DELETE CASCADE,
  question_text         TEXT NOT NULL,
  variant_type          TEXT NOT NULL CHECK (variant_type IN ('tone_variant', 'context_variant', 'custom')),
  tone                  TEXT NOT NULL CHECK (tone IN ('default', 'jokey', 'calm', 'soft')),
  requires_context      BOOLEAN NOT NULL DEFAULT false,
  repeat_cooldown_days  INT NOT NULL DEFAULT 0,
  clinical_status       TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (clinical_status IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'NEEDS_REVISION', 'REJECTED')),
  is_active             BOOLEAN NOT NULL DEFAULT true,
  sort_order            INT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_qv_group_id ON question_variants (question_group_id);
CREATE INDEX idx_qv_status_active ON question_variants (clinical_status, is_active);

-- 2. answer_evidence 테이블 생성 (아동 답변 원문을 저장하는 컬럼은 절대 없어야 함)
CREATE TABLE answer_evidence (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  child_id              UUID NOT NULL REFERENCES child_profiles(id) ON DELETE CASCADE,
  question_history_id   UUID NOT NULL REFERENCES mission_question_history(id) ON DELETE CASCADE,
  main_topic            TEXT NOT NULL,
  sub_topic             TEXT NOT NULL,
  event_summary         TEXT, -- nullable
  people                JSONB NOT NULL DEFAULT '[]'::jsonb,
  places                JSONB NOT NULL DEFAULT '[]'::jsonb,
  activities            JSONB NOT NULL DEFAULT '[]'::jsonb,
  child_emotion_words   JSONB NOT NULL DEFAULT '[]'::jsonb,
  preference_reason     TEXT, -- nullable
  desired_support       TEXT, -- nullable
  future_intent         TEXT, -- nullable
  confidence            NUMERIC(3,2) NOT NULL DEFAULT 1.00 CHECK (confidence >= 0.00 AND confidence <= 1.00),
  is_report_eligible    BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ae_child_id ON answer_evidence (child_id);
CREATE INDEX idx_ae_session_id ON answer_evidence (session_id);
CREATE INDEX idx_ae_history_id ON answer_evidence (question_history_id);

-- 3. evidence_card_links 테이블 생성
CREATE TABLE evidence_card_links (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_report_id       UUID NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  card_key              TEXT NOT NULL CHECK (card_key IN (
    'school_life', 'peer_relations', 'interests', 'study_concerns',
    'digital_interests', 'future_dreams', 'recurring_stories'
  )),
  answer_evidence_id    UUID NOT NULL REFERENCES answer_evidence(id) ON DELETE CASCADE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- emotion 태그 근거는 의도적으로 카드 링크 대상에서 제외됨(버그 아님). 감정 정보는 daily_reports.emotion_level로 별도 표현되는 기존 설계.

CREATE INDEX idx_ecl_report_id ON evidence_card_links (daily_report_id);
CREATE INDEX idx_ecl_evidence_id ON evidence_card_links (answer_evidence_id);

-- 4. question_review_history 테이블 생성 (감사 로그)
CREATE TABLE question_review_history (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id           UUID NOT NULL REFERENCES mission_questions(id) ON DELETE CASCADE,
  reviewer_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- auth.users(id) - nullable
  reviewer_email        TEXT NOT NULL,
  old_status            TEXT NOT NULL,
  new_status            TEXT NOT NULL,
  comment               TEXT,
  changed_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_qrh_question_id ON question_review_history (question_id);

-- 5. RLS 정책 설정
-- (a) question_variants RLS
ALTER TABLE question_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all_question_variants"
  ON question_variants FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "parent_read_question_variants"
  ON question_variants FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

CREATE POLICY "admin_update_question_variants"
  ON question_variants FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR get_admin_role(auth.uid()) = 'ADMIN'
  );

CREATE POLICY "reviewer_update_question_variants"
  ON question_variants FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR get_admin_role(auth.uid()) = 'REVIEWER'
  )
  WITH CHECK (
    -- REVIEWER는 is_active를 true로 활성화할 수 없음 (is_active는 false 상태여야 함)
    is_active = false
  );

-- (b) answer_evidence RLS
ALTER TABLE answer_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all_answer_evidence"
  ON answer_evidence FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "parent_read_answer_evidence" ON answer_evidence;
CREATE POLICY "admin_read_answer_evidence"
  ON answer_evidence FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR get_admin_role(auth.uid()) IS NOT NULL
  );

-- (c) evidence_card_links RLS
ALTER TABLE evidence_card_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all_evidence_card_links"
  ON evidence_card_links FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "parent_read_evidence_card_links" ON evidence_card_links;
CREATE POLICY "admin_read_evidence_card_links"
  ON evidence_card_links FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR get_admin_role(auth.uid()) IS NOT NULL
  );

-- (d) question_review_history RLS
ALTER TABLE question_review_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all_question_review_history"
  ON question_review_history FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "admin_read_question_review_history"
  ON question_review_history FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR get_admin_role(auth.uid()) IS NOT NULL
  );

CREATE POLICY "admin_insert_question_review_history"
  ON question_review_history FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      reviewer_id = auth.uid()
      AND get_admin_role(auth.uid()) IN ('ADMIN', 'REVIEWER')
    )
  );

-- 6. answer_evidence 자유텍스트 컬럼에 비식별 요약 의무 코멘트 추가
COMMENT ON COLUMN answer_evidence.event_summary IS '이 값은 반드시 AI가 생성한 비식별 요약이어야 하며 아이 발화 원문을 그대로 저장해서는 안 된다. 원문 저장 시 아동 데이터 최소수집 원칙 위반.';
COMMENT ON COLUMN answer_evidence.preference_reason IS '이 값은 반드시 AI가 생성한 비식별 요약이어야 하며 아이 발화 원문을 그대로 저장해서는 안 된다. 원문 저장 시 아동 데이터 최소수집 원칙 위반.';
COMMENT ON COLUMN answer_evidence.desired_support IS '이 값은 반드시 AI가 생성한 비식별 요약이어야 하며 아이 발화 원문을 그대로 저장해서는 안 된다. 원문 저장 시 아동 데이터 최소수집 원칙 위반.';
COMMENT ON COLUMN answer_evidence.future_intent IS '이 값은 반드시 AI가 생성한 비식별 요약이어야 하며 아이 발화 원문을 그대로 저장해서는 안 된다. 원문 저장 시 아동 데이터 최소수집 원칙 위반.';
