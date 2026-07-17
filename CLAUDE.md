# K-Bestie-v3 운영 규칙 (오케스트레이션 정책)

## 역할 분담 (필수 준수)
- **Claude Code (Opus)**: 오케스트레이션·의사결정·계획·리뷰·통합만 담당한다.
- **실제 코딩(파일 생성/수정/리팩터링/구현/버그수정)**: 전부 agy(Antigravity/Gemini)에 위임한다.
- Opus는 직접 코드를 작성·수정하지 않는다. 반드시 agy를 호출해 작업시킨다.

## agy 위임 규칙
- agy 호출 시 항상 프로젝트 경로를 명시한다: `agy --dangerously-skip-permissions --add-dir /mnt/e/VibeCoding/K-Bestie-v3 -p "<구체적 작업 지시>"`
- `--add-dir`가 없으면 agy가 scratch 폴더로 빠져 실패하므로 절대 생략하지 않는다.
- 작업 지시는 구체적으로: 대상 파일, 요구사항, 제약(GEMINI.md 경로 규칙 준수 등)을 포함한다.
- agy 호출 시 타임아웃은 최소 300초로 설정한다 (예: `timeout 300 agy ...`). 90초는 너무 짧아 결과 요약이 잘리므로 금지한다.

## Opus의 작업 절차
1. 대표님 요구를 분석하고 작업 계획을 수립한다(계획은 Opus가 직접).
2. 각 코딩 단위를 agy에 위임 지시로 변환해 실행한다.
3. agy의 결과물을 검토하고, 문제가 있을 시 다시 agy에 수정을 위임한다.
4. 최종 통합·검증 판단만 Opus가 내린다.

## 예외
- 단순 파일 읽기/구조 확인/git 상태 등 판단용 조회는 Opus가 직접 해도 된다.
- 코드 "작성/변경"은 예외 없이 agy 위임.

## 프로젝트 컨텍스트
- Next.js App Router + TypeScript + Supabase + Gemini/Vertex AI 기반 부모-자녀 실시간 음성/채팅 서비스.
- 루트에 app/, components/, hooks/, lib/, supabase/, services/ 구조. src/ 미사용.
- 경로·구조 규칙은 GEMINI.md를 우선 참조.
