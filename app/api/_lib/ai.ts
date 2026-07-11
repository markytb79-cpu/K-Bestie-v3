/**
 * AI 모델 스위치 레이어
 * 모델 교체 시 이 파일의 ACTIVE_* 상수만 변경 — 호출 코드 불변
 */

export interface VoiceModelConfig {
  modelId: string;
  apiBase: string;
  inputSampleRate: number;
  outputSampleRate: number;
}

export interface ReportModelConfig {
  modelId: string;
  apiBase: string;
  maxOutputTokens: number;
}

// ── 음성 모델 등록부 ──────────────────────────────────────────
export const VOICE_MODELS: Record<string, VoiceModelConfig> = {
  // 3.1 live preview: 공식 transcription 지원 모델, 한 이벤트에 오디오+트랜스크립션 동시 전송
  "gemini-3.1-flash-live-preview": {
    modelId: "gemini-3.1-flash-live-preview",
    apiBase: "https://generativelanguage.googleapis.com",
    inputSampleRate: 16000,
    outputSampleRate: 24000,
  },
  // native-audio preview (보관용 — transcription 이벤트 미발송 확인)
  "gemini-2.5-flash-native-audio-preview-12-2025": {
    modelId: "gemini-2.5-flash-native-audio-preview-12-2025",
    apiBase: "https://generativelanguage.googleapis.com",
    inputSampleRate: 16000,
    outputSampleRate: 24000,
  },
  // half-cascade: STT→텍스트→TTS 방식
  "gemini-2.5-flash-live-001": {
    modelId: "gemini-2.5-flash-live-001",
    apiBase: "https://generativelanguage.googleapis.com",
    inputSampleRate: 16000,
    outputSampleRate: 24000,
  },
  // fallback 2.0 계열
  "gemini-2.0-flash-live-001": {
    modelId: "gemini-2.0-flash-live-001",
    apiBase: "https://generativelanguage.googleapis.com",
    inputSampleRate: 16000,
    outputSampleRate: 24000,
  },
  // native-audio latest (보관용)
  "gemini-2.5-flash-native-audio-latest": {
    modelId: "gemini-2.5-flash-native-audio-latest",
    apiBase: "https://generativelanguage.googleapis.com",
    inputSampleRate: 16000,
    outputSampleRate: 24000,
  },
};

// ── 리포트(요약) 모델 등록부 ─────────────────────────────────
export const REPORT_MODELS: Record<string, ReportModelConfig> = {
  // JSON 모드 안정 지원 — 리포트 생성 기본값
  "gemini-2.5-flash": {
    modelId: "gemini-2.5-flash",
    apiBase: "https://generativelanguage.googleapis.com",
    maxOutputTokens: 1024,
  },
  // Gemma 계열 (JSON 모드 불안정 — 필요 시 프롬프트 튜닝 필요)
  "gemma-4-31b-it": {
    modelId: "gemma-4-31b-it",
    apiBase: "https://generativelanguage.googleapis.com",
    maxOutputTokens: 1024,
  },
};

// ── 현재 활성 모델 (여기만 바꾸면 전체 적용) ─────────────────
export const ACTIVE_VOICE_MODEL_ID = "gemini-2.5-flash-native-audio-preview-12-2025";
export const ACTIVE_REPORT_MODEL_ID = "gemma-4-31b-it";

export function getActiveVoiceModel(): VoiceModelConfig {
  const config = VOICE_MODELS[ACTIVE_VOICE_MODEL_ID];
  if (!config) throw new Error(`Unknown voice model: ${ACTIVE_VOICE_MODEL_ID}`);
  return config;
}

export function getActiveReportModel(): ReportModelConfig {
  const config = REPORT_MODELS[ACTIVE_REPORT_MODEL_ID];
  if (!config) throw new Error(`Unknown report model: ${ACTIVE_REPORT_MODEL_ID}`);
  return config;
}
