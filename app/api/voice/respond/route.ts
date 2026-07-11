import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { FREE_CHAT_SYSTEM_PROMPT } from "@/app/api/_lib/prompts";

export const runtime = "nodejs";

// 자유대화 전용 텍스트 응답 생성 모델. 리포트 생성(app/api/_lib/ai.ts의 REPORT_MODELS)과는
// 별개 레지스트리 — 리포트 경로는 이번 작업에서 손대지 않는다.
// 기존 GEMMA_API_KEY(AI Studio)를 그대로 재사용.
//
// 모델 이력: Gemma 4(gemma-4-31b-it, gemma-4-26b-a4b-it)는 @google/genai SDK로도 500 에러 확인되어 폐기.
// gemini-2.5-flash → gemini-flash-lite-latest로 교체(SDK 검증 완료, 공감·리액션 전용 용도엔 경량 모델로 충분, 더 저렴).
const CONVERSATION_MODEL_ID = "gemini-flash-lite-latest";

interface HistoryTurn { role: "child" | "k"; text: string }

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GEMMA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMMA_API_KEY not configured" }, { status: 500 });
  }

  let body: { history?: HistoryTurn[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const history = Array.isArray(body.history) ? body.history : [];
  if (history.length === 0) {
    return NextResponse.json({ error: "history required" }, { status: 400 });
  }

  const contents = history
    .filter((t) => t.text?.trim())
    .map((t) => ({
      role: t.role === "k" ? "model" : "user",
      parts: [{ text: t.text }],
    }));

  try {
    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model: CONVERSATION_MODEL_ID,
      contents,
      config: {
        systemInstruction: { parts: [{ text: FREE_CHAT_SYSTEM_PROMPT }] },
        maxOutputTokens: 256,
      },
    });

    const text = (result.text ?? "").trim();
    return NextResponse.json({ text });
  } catch (err) {
    console.error("[voice/respond] error:", (err as Error).message);
    return NextResponse.json({ error: "응답 생성 실패" }, { status: 500 });
  }
}
