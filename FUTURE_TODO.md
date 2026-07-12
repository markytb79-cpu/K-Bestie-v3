# FUTURE TODO — 내친구 케이 v3

정식 오픈 전까지 미뤄둔 작업을 한곳에 모아둔다. 항목이 생기면 이 파일에 계속 추가할 것.
각 항목은 무엇을 / 왜 / 어디를 고쳐야 하는지 순서로 적는다.

---

## 1. 요금제 선택을 결제 페이지 연동으로 전환

**무엇을**: 지금은 설정 메뉴(`아이 프로필 정보 등록`)에서 부모가 요금제(케어 스타트/인사이트/프리미엄)를
버튼 클릭 한 번으로 바로 바꿀 수 있다. 정식 오픈 시에는 "요금제 선택 → 결제 → 결제 완료 콜백에서
`child_profiles.tier` 변경"으로 흐름을 바꿔야 한다(지금처럼 무료로 즉시 전환되면 안 됨).

**왜**: 베타 기간에는 결제 시스템이 없어 임시로 즉시 전환 UI를 넣었음. 정식 과금 없이는 tier가
곧 매출과 직결되는 값이라 결제 검증 없이 바꿀 수 있으면 안 됨.

**어디**:
- `app/parent/settings/page.tsx` — 지금 요금제 버튼 클릭 시 바로 `PATCH /api/child/[id]`
  호출하는 부분(`CARE_PLANS` 버튼 onClick, "저장" 버튼 핸들러)을 결제 플로우 진입점으로 교체.
- `app/api/child/[id]/route.ts` — PATCH의 `tier` 필드를 결제 서버(웹훅/콜백) 전용 경로로 옮기거나,
  일반 PATCH에서는 제거하고 별도 엔드포인트(`/api/billing/*` 등 신설)에서만 갱신하게 제한.
- `lib/plan/voiceMode.ts`, `app/api/mission/start/route.ts` — tier→voice_mode 조회 로직 자체는
  변경 불필요(그대로 재사용 가능).

---

## 2. Tier3(Live) 하루 사용시간 상한(cap) 검토

**무엇을**: Gemini Live API 사용량에 하루 단위 상한을 두는 것을 검토·적용.

**왜**: Live 음성 비용이 분당 대략 60~80원 수준으로 추정됨. 상한이 없으면 한 아이가 하루 종일
연결해두는 경우 마진이 무너질 수 있어 비용 관리 장치가 필요함.

**어디**:
- `hooks/useGeminiLive.ts` — 세션 연결/재생 시간을 누적 추적하는 로직 추가 지점.
- `app/api/voice/token/route.ts` — ephemeral token 발급 시점에 그날 누적 사용량을 조회해서
  상한 초과 시 토큰 발급을 거부하는 서버 측 체크를 넣기 가장 적절한 위치.
- `app/child/missions/page.tsx` — 상한 도달 시 안내 UI(예: "오늘 라이브 사용 시간을 다 썼어요")
  표시 지점.
- DB: 사용량을 기록할 테이블(예: `live_usage_daily`)이 아직 없음 — 마이그레이션 필요.

---

## 3. 대화 내역 자동 파기 잡 활성화

**무엇을**: 베타 오픈 이후, 일일 리포트 생성 후 7일이 지난 원문 대화 내역(`chat_messages`)을
자동으로 삭제하는 배치 잡을 켠다.

**왜**: 프라이버시 원칙(부모도 원문 열람 불가)과 최소 보관 원칙에 맞춰 대화 원문을 무기한
보관하지 않기로 결정됨. 지금은 이 삭제 로직이 없어 계속 쌓이고 있음.

**어디**:
- `supabase/functions/daily-batch/index.ts`, `supabase/functions/_shared/batch.ts` — 기존 일일
  배치(리포트 생성 등)가 도는 곳이라 같은 크론에 파기 스텝을 추가하는 게 가장 자연스러움.
- `supabase/migrations/20260711400000_pg_cron_batch_registration.sql` — 기존 pg_cron 등록 참고해서
  파기 잡도 같은 방식으로 등록.
- 대상 테이블: `chat_messages` (session_id → daily_reports.created_at 기준 7일 경과 판단).

---

## 4. 관리자 대시보드(대화내역/사용량·비용/안전이벤트) + GCP 빌링 연동

**무엇을**: 대표(운영자)가 볼 수 있는 관리자 전용 대시보드 신설.
- 아이별/전체 대화 내역 열람(서비스 롤 경유, 부모 화면과는 별개 권한)
- 사용량·비용 현황(Gemini Live/STT/TTS 등 API 비용, GCP 빌링 API 연동)
- 안전 이벤트(`safety_events`) 모니터링 화면

**왜**: 지금은 안전 이벤트나 비용을 확인하려면 SQL을 직접 조회해야 함. 운영 규모가 커지면
직접 조회는 안 되고, 특히 안전 이벤트는 신속한 확인 체계가 필요함.

**어디**: 아직 관리자 전용 라우트가 없음 — 신설 필요. 제안 위치:
- `app/admin/**`(신규) — 관리자 전용 페이지 트리, 별도 인증/권한 체계 필요(현재 parents/
  member_accounts 권한 모델과는 다른 admin 역할 추가 검토).
- `app/api/admin/**`(신규) — safety_events, chat_messages, 사용량 조회 API.
- GCP Billing API 연동 지점은 아직 미정 — 별도 조사 필요(Cloud Billing Budget API 등).

---

## 5. 음성 대화 안정화 후 미션 재유도용 LLM 모델 업그레이드 검토

**무엇을**: `app/api/mission/respond/route.ts`의 `MISSION_CONVERSATION_MODEL_ID`를
현재 비용 절감용 `gemini-flash-lite-latest`에서 `gemini-2.5-flash`(또는 그 이상)로
업그레이드할지 재검토.

**왜**: 2026-07-12에 테스트 단계 비용 절감을 위해 flash-lite로 임시 전환했음(주석 참고).
음성 대화(에코 루프, 자막 중복, 응답 길이 등)가 다 안정화된 뒤에 품질 우선으로 되돌릴지
결정 필요.

**어디**:
- `app/api/mission/respond/route.ts` — `MISSION_CONVERSATION_MODEL_ID` 상수, 파일 내 주석에
  되돌리는 방법 이미 적혀 있음.

---

<!-- 새 항목은 위 형식(무엇을/왜/어디)을 유지해서 이 아래에 계속 추가할 것 -->
