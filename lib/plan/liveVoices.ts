// Tier3(Live) 전용 케이 목소리 — 정식 선택지(성별 그룹핑).
// 서버(API 검증)와 클라이언트(설정 메뉴 UI)가 공유하는 단일 소스.

export interface LiveVoiceOption {
  name: string;
  label: string;
  gender: "female" | "male";
}

export const LIVE_VOICE_OPTIONS: LiveVoiceOption[] = [
  { name: "Achernar", label: "Soft", gender: "female" },
  { name: "Kore", label: "Firm", gender: "female" },
  { name: "Erinome", label: "Clear", gender: "female" },
  { name: "Laomedeia", label: "Upbeat", gender: "female" },
  { name: "Pulcherrima", label: "Forward", gender: "female" },
  { name: "Orus", label: "Firm", gender: "male" },
  { name: "Rasalgethi", label: "Informative", gender: "male" },
  { name: "Alnilam", label: "Firm", gender: "male" },
];

export const LIVE_VOICE_NAMES: string[] = LIVE_VOICE_OPTIONS.map((v) => v.name);

export const DEFAULT_LIVE_VOICE_NAME = "Achernar";
