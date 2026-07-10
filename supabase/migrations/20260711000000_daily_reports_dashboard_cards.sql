-- 초안 (DDL DRAFT ONLY) — 실행 금지, 대표 승인 후 대표가 직접 실행할 것
-- 목적: 부모 홈 8개 카드 대시보드 + 감정힌트(3단계) 데이터 저장
-- 관련: Plan1.md, .omc/specs/reuse-collision-audit-newdev.md 항목 13/14

ALTER TABLE daily_reports
  ADD COLUMN emotion_level TEXT
    CHECK (emotion_level IN ('safe', 'warning', 'danger')),
  ADD COLUMN dashboard_cards JSONB NOT NULL DEFAULT '{}';

-- dashboard_cards 키 (04시 배치가 채움, 04시 배치 = generateDailyReports.ts):
--   school_life          (학교·학원 생활)
--   peer_relations       (친구 관계와 또래 생활)
--   interests             (관심사와 개인 취향)
--   study_concerns        (공부 고민)
--   digital_interests     (디지털 관심사와 콘텐츠 취향)
--   future_dreams         (미래·진로·꿈)
--   recurring_stories     (반복되는 이야기)
-- emotion_level: safe | warning | danger (감정 힌트 카드, 3번 카드)
