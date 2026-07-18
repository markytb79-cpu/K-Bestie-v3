# K-Bestie 마스터 개발 명세서 (master_plan.md)

본 문서는 K-Bestie 프로젝트의 전체 요구사항, 화면 설계, 백엔드 API 명세, 관리자 대시보드, 인프라 운영 계획 및 AI 아키텍처를 아우르는 통합 마스터 개발 명세서입니다. 기존 10개의 기획/스펙 문서 내용을 기반으로 중복을 정리하고 체계적으로 구조화하였습니다.

---

## 1. 프로젝트 개요 및 기획 배경
- **서비스명**: 내친구 케이 (K-Bestie)
- **핵심 가치**: 가족 그룹 기반 사용자 플로우를 토대로 아이들의 일상 대화를 이끌어내고, AI 분석을 통해 부모에게 맞춤형 분석 리포트를 제공하며, 비즈니스 지표(수익성 및 사용량 비용)를 효과적으로 관리 모니터링하는 것을 목표로 합니다.

---

## 2. 사용자 플로우 & 프론트엔드 구현 규격

### 2.1. 부모 사용자 플로우
1. **가입 & 로그인**: 이메일 및 비밀번호를 통한 Supabase Auth 실세션 가입/로그인. 로그인 완료 시 부모 대시보드로 이동.
2. **부모 대시보드 (최초 진입)**: 가족 정보가 없을 시 빈 화면 노출 및 "가족 만들기" 버튼 제공.
3. **가족 만들기**: 가족 이름을 입력하여 생성. 생성 후 가족 상세 화면으로 이동하며, 해당 화면에서 [아이 추가하기], [부모 초대하기] 버튼 제공 및 가족 이름 수정 기능 지원.
4. **아이 추가하기**: 이름, 학교급, 학년, 관심사 입력 및 법정대리인 필수 동의 체크 후 등록. 등록 완료 시 아이 초대 코드 발급 및 화면 표시.
5. **부모 초대하기**: 초대할 부모의 이메일을 입력하여 초대 링크(/invitations/[token]) 생성 및 화면에 표시.
6. **대시보드 (일상)**: 1일 1회 분석 리포트 확인 (아이 이름, 한 줄 요약, 기분 점수 n/10, 감정 태그, 대화 횟수, 마지막 대화 시점, 부모 가이드 포함).
7. **추가 질문 등록**: 질문 입력 시 대기중 상태로 등록. 케이가 다음 미션 시 아이에게 전달하며, 전달 완료 후 상태 변경 및 중지 기능 제공. 부모는 대화 원문을 볼 수 없으며 요약 정보만 제공받음.

### 2.2. 자녀 사용자 플로우
1. **가족 합류**: 본인 이메일로 로그인 후, 발급받은 가족 초대 코드를 입력하여 가족에 최초 1회 합류 진행 -> 아이 대시보드 진입.
2. **아이 대시보드 활동 (4종)**:
   - **미션 진행하기 (활성)**: 기본 질문 5개 + 부모 추가 질문으로 구성. 케이의 음성 질문에 대한 아이의 음성 응답(기존 로직)을 처리하며 종료 시 세션 확정.
   - **자유롭게 대화하기 (활성)**: 경청 중심으로 하루 1세션 제공 (중지 시 일시정지 상태 유지).
   - **책읽기 / 퀴즈 (비활성)**: UI 형태로만 노출되며 클릭 불가 처리.
3. **자막 노출**: 음성 질문과 답변 내용은 자막(transcription)으로 화면에 동시 표시 처리.

### 2.3. 호출 백엔드 API 명세
- **가족 관리**:
  - `POST /api/families` : body `{name}` -> `{family: {id, name, created_at}}`
  - `PATCH /api/families/:id` : body `{name}` -> `{family: {id, name}}`
  - `GET /api/families` : 사용자 소속 가족 목록 조회 -> `{families: [{family_id, role, families: {id, name}}]}`
  - `GET /api/families/:id` : 특정 가족 상세 조회 -> `{family: {id, name, family_members[], child_profiles[]}}`
- **아이 관리**:
  - `POST /api/families/:id/children` : body `{name, grade, interests[], guardian_consent: true}` -> `{child}` (201)
  - `GET /api/families/:id/children` : 가족에 속한 아이 목록 조회 -> `{children: [{id, name, grade, interests}]}`
  - `GET /api/child/:id` : 특정 자녀 프로필 상세 조회 -> `{id, name, grade, interests}`
  - `PATCH /api/child/:id` : body `{name?, grade?, interests?}` -> `{ok: true}`
  - `DELETE /api/child/:id` : 특정 자녀 프로필 삭제 -> `{ok: true}`
- **초대 & 가족 합류**:
  - `POST /api/families/:id/invite-parent` : body `{email}` -> `{token, invite_url, expires_at}`
  - `GET /api/invitations/:token` : 초대 토큰 검증 -> `{family_name, invited_email, role, expires_at}`
  - `POST /api/invitations/:token` : 초대 수락 등록 -> `{ok: true, family_id}`
  - `POST /api/children/:id/invite-code` : 자녀 초대 코드 발급 -> `{code, expires_at}`
  - `GET /api/children/:id/invite-code` : 자녀 초대 코드 조회 -> `{code, expires_at}`
  - `POST /api/auth/join-child` : 초대 코드로 자녀 합류 -> `{ok: true, family_id, child_profile_id}`
- **채팅 및 리포트**:
  - `GET /api/parent/children` -> `child_profiles` 기준 목록 반환
  - `GET /api/parent/reports` -> 전체 리포트 목록 조회
  - `GET /api/parent/reports/:id` -> 개별 리포트 상세 데이터 조회

---

## 3. 요금제(Tier) 및 리포트 차등 시스템

### 3.1. 요금제 스펙 (pricing.ts 정의)
- **Care Start**: 월 9,900원 (제한: 일 1분 분량 대화 요약 제공)
- **Care Insight**: 월 14,900원 (제한: 일 3분 분량 대화 제공)
- **Care Premium**: 월 150,000원 (무제한 케어)
- *비고*: 2026-07 ~ 2026-12-31 베타 기간에는 전원 유료 전환을 가정한 예상 매출로 정산 화면에만 표시하며, 실제 결제는 발생하지 않음 (추후 실 결제 전환용 플래그 구조 확보).

### 3.2. 리포트 제공 사양 및 UI 분기
- **Care Start**: '일간 요약' (1분 분량, 하나의 문단 크기) 및 '주간 요약'만 조회 가능. 상세 리포트 탭 진입 시 자물쇠 표시 및 "상세 리포트는 Care Insight로 업그레이드하세요" 안내 화면 제공.
- **Care Insight / Care Premium**: '일간 요약', '일간 상세', '주간 요약', '주간 상세' 4종 모두 조회 가능.
- **주간 리포트 생성 로직**:
  - 한 주간 축적된 대화 원문 전체를 AI(Gemma 모델)가 분석하여 생성하며, 미션 대화 시 목~금요일에 주말 관련 질문(주말 계획, 먹고 싶은 음식, 원하는 외식 형태 등)을 자연스럽게 아이에게 유도하도록 프롬프트 구성.
  - 생성된 주간 리포트(요약/상세 공통)에는 자녀의 답변을 기반으로 구체적인 주말 활동 추천(외식, 놀이, 나들이 계획 등)이 반드시 포함되어야 함.

---

## 4. 데이터 보존 및 다운그레이드 파기 정책

### 4.1. 요금제별 기본 데이터 보존 기간
- **Care Start**: 6개월 고정 보존.
- **Care Insight**: 기본 3년 보존. 추가 확장팩 구매 시 1년 단위로 월 +5,000원씩 최대 10년까지 확장 가능.
- **Care Premium**: 영구 보존이 기본이며, 사용자가 설정에서 하한 6개월 범위 내 자율 조정 가능.
- **유효 보존 기간 산식**: `유효 보존 기간 = 요금제 기본값 + 활성 확장팩 추가 기간`

### 4.2. 파기 및 복구 절차
1. **축소 시점 소프트 삭제**: 요금제 다운그레이드, 구독 해지, 확장팩 해지 등 보존 기간 축소 시 유효 보존 기간을 초과하는 데이터는 소프트 삭제 처리 (`deleted_at` 컬럼 업데이트로 사용자 뷰에서 제외).
2. **30일 유예 기간 운영**: 축소 시점을 기준으로 정확히 30일 동안 데이터 완전 파기를 유예함.
3. **복구**: 30일 이내에 재구독 또는 복구 시 소프트 삭제를 해제하여 데이터 재연동.
4. **완전 파기**: 30일 경과 시 Supabase Cron(pg_cron 스케줄러) 자동 파기 스케줄 잡을 통해 데이터베이스에서 완전히 삭제(하드 삭제) 처리.
5. **고지**: 다운그레이드/구독 해제 시 "데이터는 1개월 후 완전 파기됩니다" 안내 팝업을 표시하고, 파기 대상을 동적으로 계산하여 안내문구에 노출 (예: "6개월 초과 데이터", "3년 초과 데이터").

---

## 5. AI 아키텍처 및 Vertex AI 전환

### 5.1. ai.ts 모델 상수 집중화
- 여러 개별 라우트 및 파일에 흩어져 있던 모델 ID 및 프로바이더 설정을 `lib/ai.ts` 단일 지점으로集中하여 통합 관리. 한 곳에서 설정을 수정하면 프로젝트 전반에 일괄 적용되는 구조를 가짐.

### 5.2. Vertex AI 전환 및 스위칭 구조
- Google Cloud Vertex AI의 $300 크레딧 활용을 위해 AI Studio와 Vertex AI 스위칭 백엔드/프론트엔드 제어 스위치 구현.
- **기능 그룹별 3종 독립 제어**:
  - **그룹 A**: 리포트 작성 및 대화 요약
  - **그룹 B**: 미션 대화 제어
  - **그룹 C**: 라이브 음성 대화
- **라이브 스위칭 연결 모델**:
  - AI Studio: `gemini-3.1-flash-live-preview` (또는 `gemini-2.5-flash` live 버전)
  - Vertex AI: `gemini-live-2.5-flash-native-audio`
- **전환 적용 시점**: 관리자가 설정 변경 시 즉시 반영하되, 현재 진행 중인 라이브/미션 대화 세션은 원래의 모델로 끝까지 유지하여 끊김을 방지하고 다음 대화 세션부터 새 모델을 적용함.

### 5.3. Vertex Live API 연결 스펙 및 장애 처리
- **연결 실패 폴백 차단**: AI Studio로의 자동 폴백은 지원하지 않으며, Vertex 연결 실패 시 현재 세션을 강제 종료하고 아이 화면에 전용 한국어 안내 문구 표시.
  > "지금은 케이와 대화를 시작하기 어려워요. 잠시 후 다시 만나자."
- **성공 및 검증 기준**: 마이크 권한 획득 -> 아이 음성 입력 -> 케이 음성 응답 -> input transcription 수신 -> output transcription 수신 -> barge-in 동작 -> 대화 내용(transcript) 저장 -> 세션 종료 -> 리포트 생성 연동 -> iOS Safari 및 Android Chrome 테스트 통과.
- **Transcription Plan B**: 자막 누락 시 음성은 유지하되 별도 Google Cloud STT를 복합 연동하는 Plan B는 선제 구현하지 않고 보고서 및 이후 독립 작업으로 진행함.
- **로그 및 보안 정책**:
  - **기록 허용**: provider, model ID, session ID, 성공/실패 여부, 오류 코드, 지연시간(latency), transcription 수신 여부.
  - **기록 금지 (보안)**: 음성 원본 데이터, 대화 원문, API Key, access token, GCP 서비스 계정 인증 정보 등 민감정보 저장 절대 금지.

---

## 6. 관리자 대시보드 (/admin) 설계

### 6.1. 진입 구조 및 회사 전체 손익 요약
- **진입 랜딩 페이지**: 최초 접속 시 별도의 아이 선택 과정 없이 바로 "회사 전체 현황 대시보드"가 나타나며 상단의 "아이 선택" 드롭다운은 첫 화면에서 생략됨.
- **손익 요약 3대 지표 (최상단 강조)**:
  1. **들어올 돈 (예상 매출)**: ∑(요금제별 활성 아이 수 × 월 구독 요금)
  2. **나갈 돈 (총 비용)**: AI 비용(STT + TTS + Gemini Live + LLM) + 인프라 고정비(Vercel + Supabase)
  3. **남는 돈 (순이익)**: 예상 매출 − 총 비용 (흑자: 초록색, 적자: 빨간색 강조 표시, 증감률 % 동시 출력)
- **보조 지표**: 총 가입 아이 수, 요금제별 고객 분포, 누적 대화 세션 수.
- **일별 손익 추이 차트**: Recharts 라이브러리를 사용해 예상 매출선과 실제 비용선을 겹친 꺾은선그래프로 표시. 데이터가 비어 있더라도 0으로 채워 정상 렌더링.

### 6.2. Drill-down 상세 확인 구조 & 아이 1인당 수익성
- **나갈 돈 (비용 상세) 클릭 시**: 비용이 큰 항목 순으로 정렬하여 세부 항목 파고들기 지원.
  - AI 비용 4종(STT, TTS, Gemini Live, LLM)의 사용량, 추정 원가, 실제 청구액(GCP Billing), 비중 % 표시.
  - 인프라 고정비 (Vercel 월 30,000원, Supabase 월 37,500원 상수 처리).
  - 특정 AI 서비스 클릭 시 해당 서비스를 가장 많이 사용한 탑 10 사용자 순위 목록 노출.
- **가입자/매출 클릭 시**: 요금제별 인원 분포(Care Start/Insight/Premium)를 보여주고, 특정 요금제 클릭 시 소속 사용자 명단(이름, 가입일, 월 구독료, 이번 달 사용 원가, 마진 및 마진율 %)을 조회할 수 있도록 함.
- **아이 1인당 수익성 표**:
  - 컬럼: `[아이 이름] | [요금제 Tier] | [월 요금 (매출)] | [이번 달 원가 (STT+TTS+Live)] | [마진 (요금-원가)] | [마진율 %]`
  - 목적: Care Start 등 저가 요금제 가입자가 원가를 초과하여 적자를 내고 있는지 즉각 식별.
- **개별 사용자 상세 우패널 (Helicone식)**:
  - 사용자 명단이나 지표 항목 클릭 시 화면이 아래로 늘어나는 대신, 오른쪽에서 슬라이드로 열리는 우패널을 표시하여 상세 내역(대화 세션 수, 서비스별 사용량/비용, 일별 추이, 대화 내역, 안전 이벤트) 노출 후 닫기 지원.

### 6.3. 비용 데이터 수집 및 계산 로직
- **STT & TTS**: Google Cloud Billing export (BigQuery `billing_export` 데이터셋)에서 실제 SKU별 청구 비용을 직접 가져와 표시. 실시간 데이터가 아니므로 지연이 발생하는 최근 24~48시간 분량은 "집계 중" 처리 후 추정치 노출.
- **Gemini Live & LLM (텍스트)**: usage/live 라우트 세션 지속시간(초) 및 API `usageMetadata` 토큰 수를 `usage_events`에 기록하여 상수 단가로 계산.
  - *Live 오디오*: 25 tokens/초 기준, 입력 $3.00 / 1M 토큰 (분당 약 $0.005), 출력 $12.00 / 1M 토큰 (분당 약 $0.018).
  - *Wavenet TTS*: 100만 자당 $4.00.
  - *LLM (Gemini 2.5 Flash / 3.1 Flash Lite)*: `pricing.ts` 내부의 모델별 개별 단가에 기초하여 계산하며 모델별 근사치 주석 처리 적용.
- **데이터베이스 스키마 구성**:
  - `conversation_logs`: 미션/자유대화 텍스트 자막 저장 (`id`, `child_id`, `session_id`, `mode`, `voice_mode`, `speaker`, `text`, `created_at`).
  - `usage_events`: 사용량 데이터 및 원가 계산용 로그 (`id`, `child_id`, `tier`, `voice_mode`, `kind`, `duration_sec`, `char_count`, `token_in`, `token_out`, `est_cost_krw`, `created_at`).

---

## 7. 시스템 환경 설정 및 인프라 운영

### 7.1. 환경변수 및 시크릿 연동 (CLI 등록용)
- **Supabase Edge Function 시크릿**:
  - `GOOGLE_CLOUD_PROJECT=k-bestie3`
  - `GOOGLE_CLOUD_LOCATION=global`
  - `GCP_VERTEX_SA_KEY_JSON` (한 줄 문자열 형식 JSON 키)
  - `GEMMA_API_KEY`
  - `BATCH_SECRET`
- **Vercel 환경변수 (Production, Preview, Development)**:
  - `GCP_VERTEX_SA_KEY_JSON`
  - `GOOGLE_CLOUD_PROJECT=k-bestie3`
  - `GOOGLE_CLOUD_LOCATION=global`

### 7.2. GCP BigQuery Billing Export 연동 절차
1. GCP 콘솔 결제(Billing) 메뉴 진입 -> 결제 내보내기(Billing export) -> BigQuery export 탭 활성화.
2. "상세 사용 비용 데이터(Detailed usage cost data)" 항목 사용함 설정.
3. 대상 BigQuery 데이터셋 지정 및 저장.
4. 연동에 필요한 서비스 계정(SA)을 생성하여 BigQuery Read 권한을 부여하고, 발급한 키를 `GCP_VERTEX_SA_KEY_JSON` 변수로 등록.

---

## 8. 임시 검토(리뷰) 모드 & 검증 프로세스

### 8.1. ChatGPT 임시 검토 모드 설계
- **접속 방식**: 로그인 과정 없이 임시 검토 경로 및 토큰 형태로 접근 가능하게 함 (예: `/chatgpt-review-[token]`).
- **권한 제어 및 세션**: `CHATGPT_REVIEW_MODE=true` 상태에서만 활성화하며, 화면 진입 시 부모, 자녀, 관리자 역할을 스위칭할 수 있는 임시 세션 주입 UI 제공.
- **대상 계정 매핑**:
  - 부모 & 관리자: `markanitp@gmail.com`
  - 아이: `asd160202`
- **기능 제한 (보안)**: 검토 중 실수로 데이터가 오염되거나 파괴되는 것을 방지하기 위해 쓰기 기능(삭제, 회원 탈퇴, 동의 철회, 실제 결제, 데이터 복구 승인 등)은 일체 비활성화하고 읽기 화면만 정상 표시.
- **크롤링 방지**: 메타태그에 `noindex, nofollow`를 강제 설정하고 검토 완료 후 환경변수를 해제하면 즉시 차단되도록 설계.

### 8.2. 검토 모드 해제 후 원복 사후 검증 체크리스트
- **Git 형상**: 현재 브랜치 및 HEAD가 올바르게 복귀되었는지 확인하고, 리뷰 모드 전용 브랜치(`chatgpt-review-mode`) 및 커밋 내역이 main 및 개발 브랜치 히스토리에 포함되지 않았는지 점검.
- **코드 검출**: 프로젝트 전체에서 `chatgpt-review`, `CHATGPT_REVIEW_MODE`, `CHATGPT_REVIEW_TOKEN` 등 리뷰 모드 관련 문자열 및 관련 유틸/예외 라우트 디렉터리(`lib/review`, `app/chatgpt-review`)가 완벽히 삭제되었는지 확인.
- **라우트 원복**: `app/api/child/[id]/route.ts` 파일의 동의 철회 차단 임시 가드가 완전히 제거되고 정식 법정대리인 동의 철회 로직이 보존되었는지 검사.
- **Vercel 정리**: 임시 생성한 Vercel Preview 배포 인스턴스와 Preview용 리뷰 환경변수가 완전히 삭제되었는지 검증.
