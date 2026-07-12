import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { MISSION_CHAT_SYSTEM_PROMPT } from "@/app/api/_lib/prompts";

export const runtime = "nodejs";

// 테스트 단계 비용 절감을 위해 flash-lite로 임시 통일(2026-07-12).
// 되돌리려면(정식 운영 시 품질 우선): 아래 값을 "gemini-2.5-flash"로 바꾸면 됨 — 2.5-flash로 업그레이드 검토.
// TODO: 음성 대화 안정화 후 재검토 — 자세한 건 FUTURE_TODO.md 참고.
const MISSION_CONVERSATION_MODEL_ID = "gemini-flash-lite-latest";

interface HistoryTurn { role: "child" | "k"; text: string }

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GEMMA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMMA_API_KEY not configured" }, { status: 500 });
  }

  let body: { history?: HistoryTurn[]; nextQuestionText?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const history = Array.isArray(body.history) ? body.history : [];
  const nextQuestionText = typeof body.nextQuestionText === "string" ? body.nextQuestionText.trim() : "";

  if (history.length === 0 || !nextQuestionText) {
    return NextResponse.json({ error: "history and nextQuestionText required" }, { status: 400 });
  }

  // contents mapping (k -> model, child -> user)
  const contents = history
    .filter((t) => t.text?.trim())
    .map((t) => ({
      role: t.role === "k" ? "model" : "user",
      parts: [{ text: t.text }],
    }));

  const systemInstruction = `
${MISSION_CHAT_SYSTEM_PROMPT}

[현재 물어봐야 할 다음 목표 질문]
${nextQuestionText}
`.trim();

  try {
    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model: MISSION_CONVERSATION_MODEL_ID,
      contents,
      config: {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        maxOutputTokens: 1024,
      },
    });

    const text = (result.text ?? "").trim();
    return NextResponse.json({ text });
  } catch (err) {
    console.error("[mission/respond] error:", (err as Error).message);
    return NextResponse.json({ error: "미션 응답 생성 실패" }, { status: 500 });
  }
}
