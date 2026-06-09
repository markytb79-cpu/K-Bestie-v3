### 📋 작업 지시서 — [대상: Antigravity / 프론트엔드 전체]

작업명: 내친구 케이 — 가족 그룹 기반 사용자 플로우 프론트 전체 구현
목표: 확정된 사용자 플로우대로 부모/아이 화면을 전면 정리하고, 이미 구축된 백엔드 API를 호출해 실제로 동작하게 한다.
진행 모드: 자율. STOP 조건 외에는 끝까지 진행. 단, 백엔드/DB/API 로직은 절대 새로 만들거나 수정하지 말 것 — 아래 명세된 기존 API만 호출.

────────────────────────────────────
## 0. 절대 원칙
- 디자인/기능 레퍼런스는 Lovable(heartbloom-ai-pal.lovable.app) 기준 유지.
- 백엔드는 이미 완성됨. 너는 화면·라우팅·API 호출만 한다. DB 스키마/RLS/API route 로직 건드리지 마.
- 음성/Gemini Live API 대화 로직은 기존 동작 그대로 유지. 새로 짜지 말고 연결만.
- 데이터는 전부 아래 API에서 가져온다. 더미/하드코딩/demo-* 잔재 전부 제거.
- tsc --noEmit / npm run build 통과 유지.

## 1. 확정 사용자 플로우 (이대로 구현)

### 부모
- 가입(이메일+비번) → 로그인 → 부모 대시보드
- 대시보드 최초 진입 시 가족 없으면 빈 상태 → "가족 만들기" 버튼
- 가족 만들기: 가족 이름 입력 → 생성 → 가족 안에 [아이 추가하기] [부모 초대하기] 두 버튼
- 가족 이름은 나중에 수정 가능
- 아이 추가하기: 이름/학교급/학년/관심사 입력 + "법정대리인으로서 동의합니다" 체크(필수) → 등록 → 아이 초대 코드 발급·표시
- 부모 초대하기: 이메일 입력 → 초대 링크 생성(메일 발송은 추후, 지금은 링크 표시)
- 대시보드(일상): 1일 1회 리포트 확인(아이 이름/한줄요약/기분점수 n10/감정태그/대화횟수/마지막 대화 시점/부모 가이드)
- 추가 질문 등록: 질문 입력 → 대기중 → (케이가 전달) → 전달됨 → 중지 가능
- 부모는 대화 원문 열람 불가(요약만)

### 아이
- 본인 이메일로 로그인 → 가족 초대 코드 입력해 가족 합류(최초 1회) → 아이 대시보드
- 대시보드 활동 4종: ① 미션 진행하기 ② 자유롭게 대화하기 (MVP 핵심) / ③ 책읽기 ④ 퀴즈 (후순위, UI만 비활성)
- ① 미션: 기본질문 5개 + 부모 추가질문 → 케이 질문/아이 응답(음성, 기존 로직) → 종료 시 세션 확정
- ② 자유대화: 경청 중심, 하루 1세션 유지(중지=일시정지)
- 음성 질문은 화면 자막 동시 표시(기존 transcription 로직 유지)

## 2. 호출할 백엔드 API (이미 구현됨, 이대로 호출)

[가족]
POST /api/families               body:{name} → {family:{id,name,created_at}}
PATCH /api/families/:id           body:{name} → {family:{id,name}}
GET  /api/families                → {families:[{family_id,role,families:{id,name}}]}
GET  /api/families/:id            → {family:{id,name,family_members[],child_profiles[]}}

[아이]
POST /api/families/:id/children   body:{name,grade,interests[],guardian_consent:true} → {child} 201
GET  /api/families/:id/children   → {children:[{id,name,grade,interests}]}
GET  /api/child/:id               → {id,name,grade,interests}
PATCH /api/child/:id              body:{name?,grade?,interests?} → {ok:true}
DELETE /api/child/:id             → {ok:true}

[초대]
POST /api/families/:id/invite-parent  body:{email} → {token,invite_url,expires_at}
GET  /api/invitations/:token          → {family_name,invited_email,role,expires_at}
POST /api/invitations/:token          (로그인 필요) → {ok:true,family_id}
POST /api/children/:id/invite-code    body:{guardian_consent:true} → {code,expires_at}
GET  /api/children/:id/invite-code    → {code,expires_at} | {code:null}
POST /api/auth/join-child             body:{code} → {ok:true,family_id,child_profile_id}

[채팅/리포트 — 기존]
GET /api/parent/children          → children[] (child_profiles 기준)
GET /api/parent/reports           → reports[]
GET /api/parent/reports/:id       → report 상세
(채팅/리포트 생성/음성 관련은 기존 로직 그대로)

## 3. 구현 순서 체크리스트 (1번부터)
1. 부모 가입/로그인 화면 — Supabase Auth 실세션(기존 유지), 가입 후 대시보드 이동
2. 부모 대시보드 빈 상태 + "가족 만들기"(가족 이름 입력) 화면
3. 가족 상세: [아이 추가하기][부모 초대하기] 버튼 + 가족 이름 수정
4. 아이 추가 폼(정보 입력 + 법정대리인 동의 체크) → 초대 코드 발급 표시
5. 부모 초대 화면(이메일 입력 → 링크 생성·표시) + 초대 수락 페이지(/invitations/[token])
6. 아이 로그인 + 초대 코드 입력 → 가족 합류 → 아이 대시보드
7. 아이 대시보드 활동 4종(①②활성, ③④비활성)
8. 미션/자유대화 화면 — 기존 음성·자막 로직 연결(새로 짜지 말 것)
9. 부모 리포트 화면(빈 상태 포함) + 추가 질문 등록 화면
10. 전체에서 더미/demo-* 잔재 제거, tsc·build 통과 확인

## STOP 조건 (만나면 멈추고 한 줄 보고)
- Vercel 실배포 / 환경변수 변경 / 백엔드 API·DB 수정 필요 상황 / 음성 핵심 로직 재작성 필요 / API 한도 에러.

## 완료 보고 형식
① 만든/수정한 화면 목록 → ② 각 화면이 호출하는 API 매핑 → ③ 데모 동선(부모 가입~아이 대화 한 바퀴) → ④ 변경 파일 목록 → ⑤ 남은 미해결 항목 → ⑥ tsc/build 결과.
