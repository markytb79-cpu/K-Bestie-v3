// STT 전사 결과가 한국어가 아닌 문자(외국어 스크립트)를 포함하는지 판정하는 순수 헬퍼.
// 내친구 케이는 한국어 음성 대화 서비스이므로, 사용자 자막은 원칙적으로 한글·숫자·공백·
// 기본 문장부호만 허용한다. "YouTube"/"MBTI" 같은 표현도 한글 자막("유튜브"/"엠비티아이")
// 으로만 표시되면 충분하므로 영어 원문 보존을 우선하지 않는다 — 라틴 알파벳이 단 한 글자만
// 섞여도 오인식으로 간주해 재인식을 유도한다.
//
// Vertex/AI Studio Live의 자체 전사(inputTranscription)는 언어 고정 필드가 없어 아이가
// 한국어로 말해도 간혹 다른 문자권으로 잘못 전사된다. 미션·일반 대화 자막 모두 GCP STT
// (ko-KR 고정)를 1차 소스로 쓰되, 그 결과에도 외국 문자가 섞이면 이 가드로 걸러
// 재인식/재질문을 유도한다. Live inputTranscription 자체는 화면·저장·판정에 쓰지 않고
// 진단용으로만 남겨둔다.
//
// 허용(allowlist) 방식 — 아래 집합 외 문자가 하나라도 있으면 외국 스크립트로 간주한다:
//  - 한글 음절(AC00-D7A3) 및 한글 자모(자모 1100-11FF, 호환 자모 3130-318F, 확장 A A960-A97F,
//    확장 B D7B0-D7FF)
//  - ASCII 숫자, 공백
//  - 기본 문장부호(마침표/쉼표/물음표/느낌표/따옴표/괄호/붙임표 등)
// 라틴 알파벳, 한자, 히라가나/가타카나, 아랍, 키릴 등은 전부 허용되지 않으므로
// true(오염)를 반환한다.
const ALLOWED_CHAR =
  /[가-힣ᄀ-ᇿ㄰-㆏ꥠ-꥿ힰ-퟿0-9\s.,!?~'"“”‘’()[\]\-—…·:;%&@]/;

export function containsForeignScript(text: string): boolean {
  for (const ch of text) {
    if (!ALLOWED_CHAR.test(ch)) return true;
  }
  return false;
}

const HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏ꥠ-꥿ힰ-퟿]/;

// 최종 사용자 자막·저장·미션 답변 판정에 반영하기 직전, 전사 출처(GCP STT든 Live
// inputTranscription이든)와 무관하게 반드시 거쳐야 하는 단일 검증 경로.
// - 앞뒤 공백을 다듬은 뒤 빈 문자열이면 무효.
// - containsForeignScript()를 통과 못 하면(라틴/한자/가나/아랍/키릴 등 혼입) 무효.
// - 숫자·문장부호만 있고 한글이 전혀 없으면(예: "8", "...") 무효 — "유효한 대화 답변"으로
//   보지 않고 재질문 대상으로 취급한다.
// 통과하면 다듬어진 텍스트를, 아니면 null을 반환한다. 호출부는 null이면 화면 표시·DB 저장·
// /api/mission/answer 판정 어디에도 이 텍스트를 사용하지 말고 재질문 플로우로 넘어가야 한다.
export function validateFinalTranscript(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (containsForeignScript(trimmed)) return null;
  if (!HANGUL.test(trimmed)) return null;
  return trimmed;
}

// GCP STT(ko-KR)와 Live inputTranscription 중 최종 후보 하나를 정하는 순수 정책 함수 —
// 실제 네트워크 호출은 fetchGcpAttempt 콜백으로 주입받아 노드 환경에서도 테스트 가능하다.
//  1) fetchGcpAttempt()를 최대 maxGcpAttempts회(기본 2) 호출한다. 응답이 오면(null이 아니면)
//     validateFinalTranscript()로 검증하고, 통과하면 즉시 그 텍스트를 반환한다.
//  2) 한 번이라도 응답이 왔지만(=GCP가 실제로 뭔가 들었음) 끝내 검증을 통과 못 하면, Live로
//     대체하지 않고 null(거부)을 반환한다.
//  3) fetchGcpAttempt()가 매번 null(호출 자체 실패)이었을 때만 liveFallbackText를 최후 후보로
//     검토한다 — 이것도 동일하게 validateFinalTranscript()를 통과해야 한다.
export async function resolveFinalTranscript(
  fetchGcpAttempt: () => Promise<string | null>,
  liveFallbackText: string,
  maxGcpAttempts = 2
): Promise<string | null> {
  let gcpResponded = false;
  for (let attempt = 0; attempt < maxGcpAttempts; attempt++) {
    const result = await fetchGcpAttempt();
    if (result == null) continue;
    gcpResponded = true;
    const valid = validateFinalTranscript(result);
    if (valid) return valid;
  }
  if (gcpResponded) return null;
  return validateFinalTranscript(liveFallbackText);
}
