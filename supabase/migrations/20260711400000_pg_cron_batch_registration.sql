-- 초안 (DDL/크론 등록 DRAFT ONLY) — 실행 금지, 대표 승인 후 대표가 직접 실행할 것
-- 목적: Supabase pg_cron 이 배치 Edge Function 을 호출하도록 등록
--   (1) daily-batch : 매일 04:00 KST — 세션마감 → 일일리포트(감정판정/8카드)
--   (2) weekly-batch: 매주 토요일 06:00 KST — 주간요약(+주말활동추천)
--   실행 순서(일일→주간)는 같은 토요일 04:00 → 06:00 시각차로 보장됨.
--
-- 아키텍처: 배치 로직은 Supabase Edge Function 이 소스오브트루스.
--   (Next.js app/api/batch/daily/route.ts 는 로컬 수동 테스트 전용 — 운영 크론 대상 아님)
--
-- 사전 준비 (완료 상태):
--   1. Edge Function 배포: 완료 (daily-batch, weekly-batch — 2026-07-10)
--   2. 시크릿 설정: 완료 (BATCH_SECRET, GEMMA_API_KEY — supabase secrets set으로 등록됨)
--        (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 런타임 자동 주입)
--   3. 확장 활성화 — 아래 실행 전 대표가 Supabase SQL Editor에서 먼저 실행 필요:
--        create extension if not exists pg_cron;
--        create extension if not exists pg_net;
--   4. <PROJECT_REF>는 fetvnhhjicndmxvhrffk로 치환 완료.
--      <BATCH_SECRET>은 의도적으로 플레이스홀더 그대로 둠 — 이 파일은 git에 커밋되는 파일이라
--      평문 시크릿을 넣지 않는다. 실제 값은 .env.local의 BATCH_SECRET_FOR_CRON 항목 참고,
--      SQL Editor에서 이 블록을 실행하기 직전에 <BATCH_SECRET>를 그 값으로 직접 바꿔 넣을 것.
--   5. 크론 시각은 UTC 기준. KST = UTC+9.
--        04:00 KST = 19:00 UTC (전날)
--        06:00 KST 토요일 = 21:00 UTC 금요일(dow=5)

-- ── (1) 일일 배치: 매일 04:00 KST = 19:00 UTC ──────────────────────
select cron.schedule(
  'kbestie-daily-batch',
  '0 19 * * *',
  $$
  select net.http_post(
    url     := 'https://fetvnhhjicndmxvhrffk.supabase.co/functions/v1/daily-batch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <BATCH_SECRET>'
    ),
    body    := jsonb_build_object()
  );
  $$
);

-- ── (2) 주간 배치: 매주 토요일 06:00 KST = 금요일 21:00 UTC ─────────
select cron.schedule(
  'kbestie-weekly-batch',
  '0 21 * * 5',
  $$
  select net.http_post(
    url     := 'https://fetvnhhjicndmxvhrffk.supabase.co/functions/v1/weekly-batch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <BATCH_SECRET>'
    ),
    body    := jsonb_build_object('forceWeekly', true)
  );
  $$
);

-- 등록 해제:
--   select cron.unschedule('kbestie-daily-batch');
--   select cron.unschedule('kbestie-weekly-batch');
