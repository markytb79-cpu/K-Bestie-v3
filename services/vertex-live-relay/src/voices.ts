// lib/plan/liveVoices.ts의 ALL_LIVE_VOICES 이름 목록만 복제 — 이 서비스는 별도 배포 단위라
// Next.js 앱 코드를 import할 수 없다. Google 공식 30개 목소리 이름을 여기서 검증 allowlist로
// 쓴다(원본을 수정하면 반드시 여기도 동일하게 맞출 것).
export const ALL_LIVE_VOICE_NAMES: readonly string[] = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe",
  "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib",
  "Rasalgethi", "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima",
  "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
];

export const DEFAULT_LIVE_VOICE_NAME = "Achernar";

/** 티켓에 담긴 voiceName을 Google 공식 30개 목록으로 검증 — 없거나 미지원이면 기본값으로 대체. */
export function resolveVoiceName(candidate: string | undefined): string {
  if (candidate && ALL_LIVE_VOICE_NAMES.includes(candidate)) return candidate;
  return DEFAULT_LIVE_VOICE_NAME;
}
