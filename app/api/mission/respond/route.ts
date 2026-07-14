import { NextRequest, NextResponse, after } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { MISSION_CHAT_SYSTEM_PROMPT } from "@/app/api/_lib/prompts";
import { resolveUsageContext } from "@/lib/plan/voiceMode";
import { estimateCost } from "@/lib/plan/pricing";

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

  let body: { sessionId?: string; history?: HistoryTurn[]; nextQuestionText?: string };
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
      role: t.role === "k" ? ("model" as const) : ("user" as const),
      parts: [{ text: t.text }],
    }));

  // Gemini는 대화가 반드시 user 역할로 시작해야 함(그렇지 않으면 400 Bad Request).
  // 미션 히스토리는 항상 케이(K)의 오프닝 인사말로 시작하므로 맨 앞의 연속된 model
  // 턴을 제거해 user 턴부터 시작하도록 보정한다.
  while (contents.length > 0 && contents[0].role === "model") {
    contents.shift();
  }

  // 보정 후에도 비어있으면(이론상 child 발화가 아직 없는 경우) Gemini에 빈 배열을
  // 보낼 수 없으므로 다음 질문 텍스트 자체를 user 턴으로 넣어 최소 요건을 맞춘다.
  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: nextQuestionText }] });
  }

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

    const tokenIn = result.usageMetadata?.promptTokenCount;
    const tokenOut = result.usageMetadata?.candidatesTokenCount;
    if (tokenIn != null && tokenOut != null && body.sessionId) {
      const sessionId = body.sessionId;
      after(async () => {
        try {
          const ctx = await resolveUsageContext(sessionId);
          if (!ctx) return;
          const service = createServiceClient();
          const estCostKrw = estimateCost({ kind: "llm", tokenIn, tokenOut });
          await service.from("usage_events").insert({
            child_id: ctx.childId,
            tier: ctx.tier,
            voice_mode: ctx.voiceMode,
            kind: "llm",
            token_in: tokenIn,
            token_out: tokenOut,
            est_cost_krw: estCostKrw,
          });
        } catch (err) {
          console.error("[mission/respond] usage_events insert failed:", (err as Error).message);
        }
      });
    }

    return NextResponse.json({ text });
  } catch (err) {
    console.error("[mission/respond] error:", (err as Error).message);
    return NextResponse.json({ error: "미션 응답 생성 실패" }, { status: 500 });
  }
}
