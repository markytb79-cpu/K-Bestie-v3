import { NextResponse } from "next/server";
import { VOICE_MODELS, REPORT_MODELS } from "@/app/api/_lib/ai";

// dev 전용 — production 배포 시 제거 또는 인증 추가
export const runtime = "nodejs";

interface GeminiModel {
  name: string;
  displayName: string;
  description: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods: string[];
}

async function fetchGeminiModels(): Promise<GeminiModel[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`,
    { next: { revalidate: 0 } }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return (data.models ?? []) as GeminiModel[];
}

function classifyModel(model: GeminiModel) {
  const id = model.name.replace("models/", "");
  const methods = model.supportedGenerationMethods ?? [];
  const isLive =
    methods.includes("bidiGenerateContent") ||
    id.includes("live") ||
    id.includes("native-audio");
  const isGemma = id.startsWith("gemma");
  return { id, isLive, isGemma, methods };
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "debug endpoint disabled in production" }, { status: 403 });
  }

  try {
    const allModels = await fetchGeminiModels();

    const liveModels = allModels
      .map(classifyModel)
      .filter((m) => m.isLive)
      .map((m) => {
        const full = allModels.find((gm) => gm.name === `models/${m.id}`)!;
        return {
          id: m.id,
          displayName: full.displayName,
          description: full.description,
          supportedMethods: m.methods,
          inputTokenLimit: full.inputTokenLimit ?? null,
          outputTokenLimit: full.outputTokenLimit ?? null,
          registeredInAiTs: m.id in VOICE_MODELS,
        };
      });

    const gemmaModels = allModels
      .map(classifyModel)
      .filter((m) => m.isGemma)
      .map((m) => {
        const full = allModels.find((gm) => gm.name === `models/${m.id}`)!;
        return {
          id: m.id,
          displayName: full.displayName,
          description: full.description,
          supportedMethods: m.methods,
          inputTokenLimit: full.inputTokenLimit ?? null,
          outputTokenLimit: full.outputTokenLimit ?? null,
          registeredInAiTs: m.id in REPORT_MODELS,
        };
      });

    // 현재 ai.ts에 등록된 모델이 실제 API에 존재하는지 교차 검증
    const allIds = allModels.map((m) => m.name.replace("models/", ""));
    const voiceValidation = Object.keys(VOICE_MODELS).map((id) => ({
      id,
      existsInApi: allIds.includes(id),
    }));
    const reportValidation = Object.keys(REPORT_MODELS).map((id) => ({
      id,
      existsInApi: allIds.includes(id),
    }));

    return NextResponse.json({
      checkedAt: new Date().toISOString(),
      liveModels,
      gemmaModels,
      validation: {
        voiceModels: voiceValidation,
        reportModels: reportValidation,
      },
      note: {
        pricing: "https://ai.google.dev/pricing — API 응답에 단가 미포함, 링크 참조",
        sessionLimit: "Gemini Live 세션 한도: 기본 15분 / session resumption으로 연장 가능",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
