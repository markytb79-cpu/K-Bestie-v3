/**
 * AI 모델 스위치 레이어
 * 모델 교체 시 이 파일의 ACTIVE_* 상수만 변경 — 호출 코드 불변
 */

import { GoogleGenAI } from "@google/genai";
import { createServiceClient } from "@/lib/supabase/server";

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

export interface MissionModelConfig {
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

// ── 미션 대화(그룹B) 모델 등록부 ─────────────────────────────
export const MISSION_MODELS: Record<string, MissionModelConfig> = {
  // 테스트 단계 비용 절감을 위해 flash-lite로 임시 통일(2026-07-12).
  "gemini-flash-lite-latest": {
    modelId: "gemini-flash-lite-latest",
    apiBase: "https://generativelanguage.googleapis.com",
    maxOutputTokens: 1024,
  },
};

// ── 현재 활성 모델 (여기만 바꾸면 전체 적용) ─────────────────
// Tier3(Premium, Live API 음성) 전용 모델 — 공식 transcription 지원(gemini-3.1-flash-live-preview).
export const ACTIVE_VOICE_MODEL_ID = "gemini-3.1-flash-live-preview";
export const ACTIVE_REPORT_MODEL_ID = "gemma-4-31b-it";
export const ACTIVE_MISSION_MODEL_ID = "gemini-flash-lite-latest";

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

export function getActiveMissionModel(): MissionModelConfig {
  const config = MISSION_MODELS[ACTIVE_MISSION_MODEL_ID];
  if (!config) throw new Error(`Unknown mission model: ${ACTIVE_MISSION_MODEL_ID}`);
  return config;
}

// ── 그룹별 조회(Vertex 전환 스위치) ───────────────────────────
// 그룹A=리포트·요약 / 그룹B=미션 대화 / 그룹C=라이브 음성.
export type ProviderId = "ai_studio" | "vertex";
export type ModelGroup = "A" | "B" | "C";

export interface GroupModelConfig {
  group: ModelGroup;
  provider: ProviderId;
  modelId: string;
  apiBase: string;
  maxOutputTokens?: number;
  /** ai_studio일 때만 의미 있음 — 호출부가 이 이름으로 process.env를 조회한다. */
  apiKeyEnv: string;
}

/** provider_switch_settings 미조회/미설정 시 안전하게 쓰는 기존 ACTIVE_* 기반 기본값(AI Studio 고정). */
function getStaticModelForGroup(group: ModelGroup): GroupModelConfig {
  switch (group) {
    case "A": {
      const m = getActiveReportModel();
      return { group, provider: "ai_studio", modelId: m.modelId, apiBase: m.apiBase, maxOutputTokens: m.maxOutputTokens, apiKeyEnv: "GEMMA_API_KEY" };
    }
    case "B": {
      const m = getActiveMissionModel();
      return { group, provider: "ai_studio", modelId: m.modelId, apiBase: m.apiBase, maxOutputTokens: m.maxOutputTokens, apiKeyEnv: "GEMMA_API_KEY" };
    }
    case "C": {
      const m = getActiveVoiceModel();
      return { group, provider: "ai_studio", modelId: m.modelId, apiBase: m.apiBase, apiKeyEnv: "GEMMA_API_KEY" };
    }
  }
}

// request-scoped에 가까운 짧은 TTL 메모 — 매 호출 DB 왕복 없이도 스위치 변경이 수 초 내 반영됨.
// (Vercel 서버리스 인스턴스가 재활용되는 동안에만 유효 — 인스턴스마다 독립 캐시라 안전)
const SWITCH_TTL_MS = 10_000;
const switchCache = new Map<ModelGroup, { config: GroupModelConfig; expiresAt: number }>();

/** 그룹(A/B/C)의 현재 provider+model을 DB(provider_switch_settings)에서 조회.
 *  조회 실패/미설정 시 기존 ACTIVE_* 기반 AI Studio 설정으로 안전하게 폴백한다. */
export async function getModelForGroup(group: ModelGroup): Promise<GroupModelConfig> {
  const cached = switchCache.get(group);
  if (cached && cached.expiresAt > Date.now()) return cached.config;

  const fallback = getStaticModelForGroup(group);
  try {
    const service = createServiceClient();
    const { data } = await service
      .from("provider_switch_settings")
      .select("provider, model_id")
      .eq("group", group)
      .maybeSingle();

    const provider = ((data as { provider?: string } | null)?.provider as ProviderId) ?? fallback.provider;
    const modelId = (data as { model_id?: string } | null)?.model_id ?? fallback.modelId;

    const config: GroupModelConfig = {
      group,
      provider,
      modelId,
      apiBase: fallback.apiBase,
      maxOutputTokens: fallback.maxOutputTokens,
      apiKeyEnv: provider === "vertex" ? "GCP_VERTEX_SA_KEY_JSON" : "GEMMA_API_KEY",
    };
    switchCache.set(group, { config, expiresAt: Date.now() + SWITCH_TTL_MS });
    return config;
  } catch {
    // provider_switch_settings 조회 실패(테이블 미실행 등) — 안전하게 기존 동작 유지
    return fallback;
  }
}

/** GroupModelConfig에 맞는 GoogleGenAI 클라이언트를 생성(provider별 자격증명 분기).
 *  Vertex: GCP_VERTEX_SA_KEY_JSON 서비스 계정 키(GCP_BILLING_SA_KEY_JSON과 완전 분리) +
 *  GOOGLE_CLOUD_PROJECT/GOOGLE_CLOUD_LOCATION(Google Gen AI SDK 표준 환경변수명). AI Studio: GEMMA_API_KEY. */
export function createGenAIClient(config: Pick<GroupModelConfig, "provider" | "apiKeyEnv">): GoogleGenAI {
  if (config.provider === "vertex") {
    const keyJson = process.env.GCP_VERTEX_SA_KEY_JSON;
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    if (!keyJson) throw new Error("GCP_VERTEX_SA_KEY_JSON not configured");
    if (!project) throw new Error("GOOGLE_CLOUD_PROJECT not configured");
    const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
    const credentials = JSON.parse(keyJson);
    return new GoogleGenAI({ vertexai: true, project, location, googleAuthOptions: { credentials } });
  }
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) throw new Error(`${config.apiKeyEnv} not configured`);
  return new GoogleGenAI({ apiKey });
}

/** 폴백 전용: provider와 무관하게 항상 AI Studio(GEMMA_API_KEY)로 교차 회귀하는 클라이언트.
 *  Vertex 장애 시에도 서비스 연속성을 확보하기 위함(report/generate 폴백 경로 전용). */
export function createAIStudioFallbackClient(): GoogleGenAI {
  const apiKey = process.env.GEMMA_API_KEY;
  if (!apiKey) throw new Error("GEMMA_API_KEY not configured");
  return new GoogleGenAI({ apiKey });
}
