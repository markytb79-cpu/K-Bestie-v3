# K-Bestie-v3 운영 규칙 (CLAUDE.md — 오케스트레이터)

> 환경: **WSL2 + Claude Max/Pro** · OMC(oh-my-claudecode) v4.15.x (Team-first)
> 프로젝트 경로: `/mnt/e/VibeCoding/K-Bestie-v3`
> 역할: Claude = 오케스트레이터, 실제 실행 = Antigravity/Gemini 3.5 Flash

---

## 0. 역할 분담 (필수 준수)
- **Claude Code**: 오케스트레이션·계획·작업 분해·위임 지시 작성·검증·통합만 담당한다.
- **실제 코딩(생성/수정/리팩터링/구현/버그수정)**: 전부 agy(Antigravity/Gemini 3.5 Flash)에 위임한다.
- Claude는 직접 코드를 작성·수정하지 않는다. 반드시 agy를 호출해 작업시킨다.
- 코드 정합성·스택 규칙 위반의 **최종 검증 책임은 Claude에게 있다**(Gemini에게 검증을 맡기지 않는다).

## 1. 모델 라우팅 정책
- **Opus 4.8**: 초기 아키텍처 설계, 복잡한 작업 분해(subtask 경계 결정). 명세가 애매하면 Gemini가 멋대로 채우므로 이 단계는 반드시 Opus로 단단히 잡는다.
- **Sonnet 5**: 그 외 오케스트레이션 전반 — 위임 지시 작성, 진행 관리, agy 결과 검증, 통합 판단. 반복적·프로세스 지향 작업에 적합하고 비용 효율이 좋다.
- **Gemini 3.5 Flash (High effort)**: 모든 실제 코드 실행.
- 전환 기준: 새 기능/모듈의 설계·분해 시작 시 Opus, 그 이후 실행 루프는 Sonnet 5.

## 2. OMC 운영 방식
- 오케스트레이션은 OMC를 1차 수단으로 사용하되 **Team이 정식 표면**이다(구 `swarm`/`plan this:` 미사용).
- 강도별 지시: 기능 1개는 `/autopilot`, 대규모·완결 필수는 `/ralph`, 다수 독립 작업은 `/ultrawork`(`ulw`), 계획/아키텍처 합의는 `/ralplan`, 요구 모호 시 `/deep-interview` 먼저.
- **병렬 적극 활용**: Antigravity 계정 로테이션으로 실행 자원이 넉넉하므로, 독립 작업은 agy 인스턴스를 여러 개 띄워 병렬 처리한다(`ulw` / `omc team N:antigravity`의 N을 크게).
- 세션 상태·계획·메모는 `.omc/`에 유지(컨텍스트 압축 대비). 중단은 `stopomc`.
- 모든 경로·명령은 WSL2(`/mnt/...`) 기준.

## 3. agy 위임 규칙
- 항상 프로젝트 경로 명시:
  `timeout 300 agy --dangerously-skip-permissions --add-dir /mnt/e/VibeCoding/K-Bestie-v3 -p "<구체적 작업 지시>"`
- `--add-dir` 절대 생략 금지(scratch 폴더로 빠져 실패).
- **타임아웃 최소 300초**(90초 금지, 결과 잘림). 대량 작업은 상향.
- **effort는 High 고정**(Medium은 너무 빨라 정합성 흔들림).
- 위임 지시에는 반드시 포함: ① 대상 파일(경로), ② 요구사항, ③ 제약·금지사항(GEMINI.md 규칙 준수 명시), ④ **"구현 전 계획을 먼저 출력하고 진행"** 게이트, ⑤ **"결과는 변경 파일 목록 + diff 요약 + 검증 포인트만 반환"**(장황한 walkthrough 금지 — 컨텍스트 오염 방지).

## 4. Claude의 작업 절차 (검증 루프)
1. 요구 분석 → 계획 수립(설계·분해는 Opus).
2. 각 코딩 단위를 구조화된 위임 지시로 변환해 agy 실행.
3. agy 결과(diff) 검토 — **아래 5. 검증 체크리스트로 직접 확인**.
4. 위반·문제 발견 시 구체적 수정 지시로 agy에 재위임.
5. 최종 통합·검증 판단만 Claude가 내린다.

## 5. 검증 체크리스트 (agy 결과 리뷰 시 필수 확인)
- [ ] `@google/genai`만 사용, 구버전/REST 직접 호출 없음.
- [ ] `Promise.all` 없이 `Promise.allSettled` 사용.
- [ ] `responseMimeType` 미사용, JSON은 스키마 강제 + `extractJSON` 파싱.
- [ ] Supabase 테이블에 `GRANT ALL ... TO anon, authenticated` 포함.
- [ ] AI 키에 `NEXT_PUBLIC_` 접두사 없음(서버 전용 유지).
- [ ] 경로·구조가 GEMINI.md 규칙 준수(`src/` 미사용 등).
- [ ] 요구한 대상 파일만 변경, 범위 이탈·중복 작업 없음.

## 6. 예외
- 단순 파일 읽기 / 구조 확인 / git 상태 등 판단용 조회는 Claude가 직접 해도 된다.
- 코드 "작성/변경"은 예외 없이 agy 위임.

## 7. 메모리 & 상태 관리
- 불변 규칙은 영구 기억으로 기록:
# K-Bestie-v3 운영 규칙 (CLAUDE.md — 오케스트레이터)

> 환경: **WSL2 + Claude Max/Pro** · OMC(oh-my-claudecode) v4.15.x (Team-first)
> 프로젝트 경로: `/mnt/e/VibeCoding/K-Bestie-v3`
> 역할: Claude = 오케스트레이터, 실제 실행 = agy(Antigravity/**Gemini 3.1 Pro (High)**)
> agy 모델은 `~/.gemini/antigravity-cli/settings.json`에 `Gemini 3.1 Pro (High)`로 고정(계정 A/B/C 공통). 쿼터 소진 시 계정 로그아웃/로그인으로 로테이션(모델 설정 유지됨).

---

## 0. 역할 분담 (필수 준수)
- **Claude Code**: 오케스트레이션·계획·작업 분해·위임 지시 작성·검증·통합만 담당한다.
- **실제 코딩(생성/수정/리팩터링/구현/버그수정)**: 전부 agy(Antigravity/Gemini 3.1 Pro (High))에 위임한다.
- Claude는 직접 코드를 작성·수정하지 않는다. 반드시 agy를 호출해 작업시킨다.
- 코드 정합성·스택 규칙 위반의 **최종 검증 책임은 Claude에게 있다**(Gemini에게 검증을 맡기지 않는다). 별도 검증 워커로 codex를 둘 수 있으나, 최종 통합 판단은 Claude가 내린다.

---

## 1. 모델 라우팅 정책
- **Opus 4.8**: 초기 아키텍처 설계, 복잡한 작업 분해(subtask 경계 결정). 명세가 애매하면 Gemini가 멋대로 채우므로 이 단계는 반드시 Opus로 단단히 잡는다.
- **Sonnet 5**: 그 외 오케스트레이션 전반 — 위임 지시 작성, 진행 관리, agy 결과 검증, 통합 판단. 반복적·프로세스 지향 작업에 적합하고 비용 효율이 좋다.
- **Gemini 3.1 Pro (High)**: 모든 실제 코드 실행(agy CLI, settings.json 고정값).
- 전환 기준: 새 기능/모듈의 설계·분해 시작 시 Opus, 그 이후 실행 루프는 Sonnet 5.

---

## 2. OMC 운영 방식
- 오케스트레이션은 OMC를 1차 수단으로 사용하되 **Team이 정식 표면**이다(구 `swarm`/`plan this:` 미사용).
- 강도별 지시: 기능 1개는 `/autopilot`, 대규모·완결 필수는 `/ralph`, 다수 독립 작업은 `/ultrawork`(`ulw`), 계획/아키텍처 합의는 `/ralplan`, 요구 모호 시 `/deep-interview` 먼저.
- **병렬 적극 활용**: Antigravity 계정 로테이션으로 실행 자원이 넉넉하므로, 독립 작업은 agy 인스턴스를 여러 개 띄워 병렬 처리한다(`ulw` / `omc team N:antigravity`의 N을 크게).
- 세션 상태·계획·메모는 `.omc/`에 유지(컨텍스트 압축 대비). 중단은 `stopomc`.
- 모든 경로·명령은 WSL2(`/mnt/...`) 기준.

---

## 3. agy 위임 규칙
- 항상 프로젝트 경로 + 모델 명시:
  `timeout 300 agy --dangerously-skip-permissions --add-dir /mnt/e/VibeCoding/K-Bestie-v3 --model="Gemini 3.1 Pro (High)" -p "<구체적 작업 지시>"`
- `--add-dir` 절대 생략 금지(scratch 폴더로 빠져 실패).
- **`--model="Gemini 3.1 Pro (High)"`는 이중 안전장치**다. 기본값은 settings.json에 고정돼 있으나, headless(`-p`)에서 플래그가 무시될 수 있으므로 settings.json 고정을 1차 보장으로 삼는다(계정 전환 후 settings.json에 model 필드가 유지되는지 점검).
- **타임아웃 최소 300초**(90초 금지, 결과 잘림). 대량 작업은 상향.
- **effort는 High 고정**(Medium은 너무 빨라 정합성 흔들림). → 모델명 자체에 (High) 포함.
- 위임 지시에는 반드시 포함: ① 대상 파일(경로), ② 요구사항, ③ 제약·금지사항(GEMINI.md 규칙 준수 명시), ④ **"구현 전 계획을 먼저 출력하고 진행"** 게이트, ⑤ **"결과는 변경 파일 목록 + diff 요약 + 검증 포인트만 반환"**(장황한 walkthrough 금지 — 컨텍스트 오염 방지).

---

## 4. Claude의 작업 절차 (검증 루프)
1. 요구 분석 → 계획 수립(설계·분해는 Opus).
2. 각 코딩 단위를 구조화된 위임 지시로 변환해 agy 실행.
3. agy 결과(diff) 검토 — **아래 5. 검증 체크리스트로 직접 확인**.
4. 위반·문제 발견 시 구체적 수정 지시로 agy에 재위임.
5. 최종 통합·검증 판단만 Claude가 내린다.

---

## 5. 검증 체크리스트 (agy 결과 리뷰 시 필수 확인)
- [ ] `@google/genai`만 사용, 구버전/REST 직접 호출 없음.
- [ ] `Promise.all` 없이 `Promise.allSettled` 사용.
- [ ] `responseMimeType` 미사용, JSON은 스키마 강제 + `extractJSON` 파싱.
- [ ] Supabase 테이블에 `GRANT ALL ... TO anon, authenticated` 포함.
- [ ] AI 키에 `NEXT_PUBLIC_` 접두사 없음(서버 전용 유지).
- [ ] 경로·구조가 GEMINI.md 규칙 준수(`src/` 미사용 등).
- [ ] 요구한 대상 파일만 변경, 범위 이탈·중복 작업 없음.

---

## 6. 예외
- 단순 파일 읽기 / 구조 확인 / git 상태 등 판단용 조회는 Claude가 직접 해도 된다.
- 코드 "작성/변경"은 예외 없이 agy 위임.

---

## 7. 메모리 & 상태 관리
- 불변 규칙(역할 분담, 모델 라우팅, 검증 체크리스트, agy 위임 규칙)은 영구 기억으로 기록하고, 세션 상태·진행 이력·계획은 `.omc/`에 유지한다.
- 컨텍스트 압축 후에도 위 역할(0번: 오케스트레이션 전담, 직접 코딩 금지)과 agy 위임 규칙(3번), 검증 루프(4번)는 반드시 재확인 후 작업을 재개한다.
- agy 결과 검증을 완료하지 못한 채 세션이 끊긴 경우, 남은 검증 대상과 진행 상태를 `.omc/`에 명확히 기록한다.

---

## 8. 위험 작업 안전장치 (필수)
- **프로덕션 데이터 삭제·수정(Supabase DELETE/UPDATE), 프로덕션 DB/배포 변경, 인증·권한·결제 로직 변경**은 자동 실행 금지. 반드시 검증을 거치고 **대표(형진님)의 명시적 승인** 후에만 진행한다(2026-07 프로덕션 데이터 1,800건 삭제 사고 재발 방지).
- 위 작업을 agy에 위임할 때는 위임 지시에 "삭제·프로덕션 변경 금지, 필요 시 제안만" 제약을 명시한다.
- 파괴적 작업(대량 삭제, .git 손상 등)은 사전에 복구용 커밋 해시를 확보하고 진행한다.

---

## 9. 규칙 파일 보존 원칙 (재발 방지 — 필수)
- **이 파일(CLAUDE.md)을 포함한 규칙 문서(AGENTS.md, GEMINI.md)는 생성·수정 즉시 반드시 git commit 한다.** 커밋되지 않은 규칙 파일은 워커/정리 작업으로 소실될 수 있으며, 미커밋 상태로 삭제되면 복구가 불가능하다(2026-07-18 AGENTS.md 실종 사고 재발 방지).
- 규칙 파일 변경 시 커밋 예시: `[설정] CLAUDE.md 오케스트레이터 규칙 갱신`.
- **규칙 파일(AGENTS.md / CLAUDE.md / GEMINI.md)을 삭제·이동·이름 변경하지 않는다.** OMC 워커가 동일 이름(`AGENTS.md` 등)의 프로토콜 문서를 생성하더라도 프로젝트 루트의 규칙 파일을 덮어쓰거나 지우지 않는다.
- **세션 시작 시** 루트에 AGENTS.md / CLAUDE.md / GEMINI.md 세 파일이 모두 존재하는지 확인한다. 하나라도 없으면 작업 위임 전에 먼저 복원(백업 또는 `git checkout HEAD -- <파일>`)하고 커밋한다.
