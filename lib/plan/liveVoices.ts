// Tier3(Live) 전용 케이 목소리 — 정식 선택지.
// 서버(API 검증)와 클라이언트(설정 메뉴 UI)가 공유하는 단일 소스.
//
// Vertex AI 전환 검토(2026-07) 중 확인된 사실:
// - Gemini Live API(gemini-live-2.5-flash-native-audio 포함)는 AI Studio·Vertex 양쪽 모두
//   TTS 모델과 동일한 목소리 카탈로그를 공유한다(Google 공식 문서). 실제로 Vertex 릴레이
//   실연결 테스트에서 기본값 Achernar가 정상 동작함을 확인했다 — 나머지 7개는 이 카탈로그
//   공유 원칙상 마찬가지로 동작할 것으로 보이나, 개별 확인은 아직 하지 않았다(verified 참고).
// - Google이 공식적으로 공개하는 메타데이터는 "목소리 이름 + 한 단어 특성(characteristic)"뿐이다
//   (예: Achernar–Soft, Kore–Firm). "성별(남/여)" 컬럼은 Google 문서 어디에도 없다 — 아래
//   ALL_LIVE_VOICES의 characteristic까지는 공식 근거가 있고, LIVE_VOICE_OPTIONS의 gender는
//   이번 조사 이전부터 있던 비공식 분류(제3자 관행을 따라간 것으로 추정)를 잠정 유지한 것이다.

export type VoiceCategory = "female" | "male";

export interface LiveVoiceOption {
  name: string;
  /** Google 공식 문서의 "Characteristics" 한 단어 표기 그대로. */
  label: string;
  /** 비공식·잠정 분류(Google 메타데이터 아님) — 아래 설명 참고. UI 그룹핑에만 쓴다. */
  gender: VoiceCategory;
  /** Vertex Live에서 개별 실연결로 확인됐는지 — 확인 전엔 false. */
  verifiedOnVertex: boolean;
}

// 아이 설정 화면(app/child/settings/page.tsx)에 실제로 노출하는 8개 — 기존 그대로 유지.
// gender 분류는 향후 실제 한국어 음성을 다 들어본 뒤 "아이 친화형/차분형/활기형" 같은
// 서비스 자체 category로 교체할 예정(ALL_LIVE_VOICES.category 참고, 아래 TODO).
export const LIVE_VOICE_OPTIONS: LiveVoiceOption[] = [
  { name: "Achernar", label: "Soft", gender: "female", verifiedOnVertex: true },
  { name: "Kore", label: "Firm", gender: "female", verifiedOnVertex: false },
  { name: "Erinome", label: "Clear", gender: "female", verifiedOnVertex: false },
  { name: "Laomedeia", label: "Upbeat", gender: "female", verifiedOnVertex: false },
  { name: "Pulcherrima", label: "Forward", gender: "female", verifiedOnVertex: false },
  { name: "Orus", label: "Firm", gender: "male", verifiedOnVertex: false },
  { name: "Rasalgethi", label: "Informative", gender: "male", verifiedOnVertex: false },
  { name: "Alnilam", label: "Firm", gender: "male", verifiedOnVertex: false },
];

export const LIVE_VOICE_NAMES: string[] = LIVE_VOICE_OPTIONS.map((v) => v.name);

export const DEFAULT_LIVE_VOICE_NAME = "Achernar";

// ── Google 공식 30개 전체 목록 (참고/향후 확장용, 아이 설정 UI에는 아직 노출 안 함) ──
// name + characteristic은 Google 공식 문서(Gemini API 음성 생성 가이드) 표기 그대로.
// TODO(향후, 선제 구현 금지): 실제 한국어 음성으로 30개를 전부 들어본 뒤, gender 대신
// "아이 친화형" / "차분형" / "활기형" 같은 서비스 자체 category로 교체하고, 그 결과에 따라
// LIVE_VOICE_OPTIONS(설정 UI 노출 목록)를 이 전체 목록에서 다시 골라 구성할 것.
export interface OfficialLiveVoice {
  name: string;
  characteristic: string;
}

export const ALL_LIVE_VOICES: OfficialLiveVoice[] = [
  { name: "Zephyr", characteristic: "Bright" },
  { name: "Puck", characteristic: "Upbeat" },
  { name: "Charon", characteristic: "Informative" },
  { name: "Kore", characteristic: "Firm" },
  { name: "Fenrir", characteristic: "Excitable" },
  { name: "Leda", characteristic: "Youthful" },
  { name: "Orus", characteristic: "Firm" },
  { name: "Aoede", characteristic: "Breezy" },
  { name: "Callirrhoe", characteristic: "Easy-going" },
  { name: "Autonoe", characteristic: "Bright" },
  { name: "Enceladus", characteristic: "Breathy" },
  { name: "Iapetus", characteristic: "Clear" },
  { name: "Umbriel", characteristic: "Easy-going" },
  { name: "Algieba", characteristic: "Smooth" },
  { name: "Despina", characteristic: "Smooth" },
  { name: "Erinome", characteristic: "Clear" },
  { name: "Algenib", characteristic: "Gravelly" },
  { name: "Rasalgethi", characteristic: "Informative" },
  { name: "Laomedeia", characteristic: "Upbeat" },
  { name: "Achernar", characteristic: "Soft" },
  { name: "Alnilam", characteristic: "Firm" },
  { name: "Schedar", characteristic: "Even" },
  { name: "Gacrux", characteristic: "Mature" },
  { name: "Pulcherrima", characteristic: "Forward" },
  { name: "Achird", characteristic: "Friendly" },
  { name: "Zubenelgenubi", characteristic: "Casual" },
  { name: "Vindemiatrix", characteristic: "Gentle" },
  { name: "Sadachbia", characteristic: "Lively" },
  { name: "Sadaltager", characteristic: "Knowledgeable" },
  { name: "Sulafat", characteristic: "Warm" },
];
