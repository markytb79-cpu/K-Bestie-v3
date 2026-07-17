[작업] Vertex Live API 실제 연결 구현

확정된 제품 결정:

1. 적용 범위
- 형진님 테스트 계정에서 먼저 검증한다.
- 성공 후 지정 테스트 그룹에만 제한 적용한다.
- 전체 사용자에게 즉시 적용하지 않는다.

2. Vertex 연결 실패 처리
- AI Studio 자동 fallback은 구현하지 않는다.
- Vertex 연결 실패 시 현재 대화를 종료한다.
- 기존 관리자 스위치를 통해 수동으로 AI Studio로 복귀할 수 있게 유지한다.
- 아이 화면에는 기술 오류 대신 아래 문구를 표시한다.

“지금은 케이와 대화를 시작하기 어려워요.
잠시 후 다시 만나자.”

3. 성공 기준
아래 전 과정이 모두 성공해야 완료로 판정한다.
- 마이크 시작
- 아이 음성 입력
- 케이 음성 응답
- input transcription
- output transcription
- barge-in
- transcript 저장
- 세션 종료
- 리포트 입력 연결
- iOS Safari 테스트
- Android Chrome 테스트

4. transcription Plan B
- 이번 작업에서는 별도 STT를 구현하지 않는다.
- 음성은 정상인데 transcript가 반복 누락되면 그 사실을 명확히 보고한다.
- 이후 Vertex Live API는 대화·음성 출력에 유지하고 Google Cloud STT를 추가하는 별도 Plan B 작업으로 진행한다.
- Plan B를 선제 구현하지 않는다.

5. 로그 정책
기록 허용:
- provider
- model ID
- session ID
- 성공/실패
- 오류코드
- 지연시간
- input/output transcription 수신 여부

기록 금지:
- 음성 원본
- 전체 대화 원문
- API Key
- access token
- 서비스 계정 인증정보

기존 구현 재사용:
- 관리자 AI Studio ↔ Vertex 스위치
- provider_switch_settings
- 기존 AI Studio Live 경로
- 기존 세션 적용 정책

핵심 목표:
관리자 화면에서 그룹C를 Vertex로 선택한 경우, 새 라이브 세션이 실제로
`gemini-live-2.5-flash-native-audio`
모델에 연결되게 한다.

금지:
- 관리자 스위치 UI 재작성
- 설정 테이블 신규 생성
- AI Studio 기존 경로 삭제
- 자동 fallback 구현
- DB 마이그레이션 실제 실행
- 실배포
- Secret 출력
- Plan B STT 선제 구현

완료 보고:
1. 실제 연결된 provider/model
2. 전체 음성 흐름 테스트 결과
3. input/output transcription 결과
4. transcript 및 리포트 연결 결과
5. iOS/Android 테스트 결과
6. 변경 파일 목록
7. 필요한 환경변수 이름
8. 미해결 문제
9. Plan B 필요 여부