import { NextRequest, NextResponse, after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { MISSION_CHAT_SYSTEM_PROMPT } from "@/app/api/_lib/prompts";
import { getModelForGroup, createGenAIClient } from "@/app/api/_lib/ai";
import { resolveUsageContext } from "@/lib/plan/voiceMode";
import { estimateCost } from "@/lib/plan/pricing";

export const runtime = "nodejs";

interface HistoryTurn { role: "child" | "k"; text: string }

/** KST(UTC+9) 기준 오늘이 목요일(4) 또는 금요일(5)인지 — 주말 질문을 자연스럽게 꺼낼 요일. */
function isWeekendQuestionDay(): boolean {
  const kstDay = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCDay(); // 0=일 ... 4=목, 5=금
  return kstDay === 4 || kstDay === 5;
}

const WEEKEND_QUESTION_PROMPT = `
[오늘의 추가 대화 유도 — 목·금 전용]
오늘 대화 중 자연스러운 타이밍에 딱 한 번만, 아이에게 이번 주말 계획을 가볍게 물어봐 주세요.
아래 세 가지 중 하나를 골라 자연스럽게 물어보면 됩니다(전부 다 물어보지 않아도 됨):
- 이번 주말에 뭐 하고 싶은지
- 이번 주말에 뭐 먹고 싶은지
- 부모님과 어떤 외식을 하고 싶은지
아이가 답한 내용은 이번 주 리포트의 주말 활동 추천에 쓰일 수 있으니, 답을 들으면 짧게 공감해 주세요.
`.trim();

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const missionModel = await getModelForGroup("B");
  let ai;
  try {
    ai = createGenAIClient(missionModel);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
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
${isWeekendQuestionDay() ? `\n${WEEKEND_QUESTION_PROMPT}` : ""}
`.trim();

  try {
    const result = await ai.models.generateContent({
      model: missionModel.modelId,
      contents,
      config: {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        maxOutputTokens: missionModel.maxOutputTokens ?? 1024,
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
