import { NextRequest, NextResponse, after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { MISSION_CHAT_SYSTEM_PROMPT, WEEKEND_QUESTION_PROMPT } from "@/app/api/_lib/prompts";
import { getModelForGroup, createGenAIClient } from "@/app/api/_lib/ai";
import { resolveUsageContext } from "@/lib/plan/voiceMode";
import { estimateCost } from "@/lib/plan/pricing";
import { checkConsentForSession } from "@/lib/plan/consentGuard";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

interface HistoryTurn { role: "child" | "k"; text: string }

/** KST(UTC+9) 기준 오늘이 목요일(4) 또는 금요일(5)인지 — 주말 질문을 자연스럽게 꺼낼 요일. */
function isWeekendQuestionDay(): boolean {
  const kstDay = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCDay(); // 0=일 ... 4=목, 5=금
  return kstDay === 4 || kstDay === 5;
}

// 모델 응답에 프롬프트/지시문이 그대로 새어나온 흔적이 있는지 검사 — 감지되면 부분 절삭
// 없이 응답 전체를 폐기하는 판단 기준으로만 쓴다(아래 POST 핸들러 참고).
const PROMPT_LEAK_PATTERNS = [
  /\[[^\]]*\]/, // 대괄호로 감싼 헤더/라벨
  /라고\s*말하면\s*돼/,
  /시스템\s*지시/,
  /현재\s*물어봐야\s*할/,
  /목표\s*질문/,
];
function containsPromptLeak(text: string): boolean {
  return PROMPT_LEAK_PATTERNS.some((re) => re.test(text));
}

// childTurnId 기준 짧은 TTL 인메모리 캐시 — 클라이언트 쪽 레이스로 같은 아이 턴에 대해
// 이 라우트가 중복 호출돼도 LLM을 두 번 부르지 않고 첫 응답을 재사용한다. 서버리스
// 인스턴스별로만 유효한 best-effort 가드이며(DB 스키마 변경 없음), 주 방어선은
// 클라이언트의 재진입 가드(app/child/missions/page.tsx)다.
const respondCache = new Map<string, { text: string; ts: number }>();
const RESPOND_CACHE_TTL_MS = 15_000;
function getCachedRespond(key: string): string | null {
  const hit = respondCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > RESPOND_CACHE_TTL_MS) {
    respondCache.delete(key);
    return null;
  }
  return hit.text;
}
function setCachedRespond(key: string, text: string) {
  if (respondCache.size > 200) {
    const oldestKey = respondCache.keys().next().value;
    if (oldestKey) respondCache.delete(oldestKey);
  }
  respondCache.set(key, { text, ts: Date.now() });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { sessionId?: string; history?: HistoryTurn[]; nextQuestionText?: string; childTurnId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const history = Array.isArray(body.history) ? body.history : [];
  const nextQuestionText = typeof body.nextQuestionText === "string" ? body.nextQuestionText.trim() : "";
  const childTurnId = typeof body.childTurnId === "string" ? body.childTurnId : null;

  if (history.length === 0 || !nextQuestionText) {
    return NextResponse.json({ error: "history and nextQuestionText required" }, { status: 400 });
  }
  if (!body.sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const consentBlocked = await checkConsentForSession(body.sessionId);
  if (consentBlocked) return consentBlocked;

  const authService = createServiceClient();
  const { data: session } = await authService
    .from("chat_sessions")
    .select("child_id")
    .eq("id", body.sessionId)
    .single();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const authCheck = await requireChildAccess(authService, user.id, session.child_id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (childTurnId) {
    const cached = getCachedRespond(childTurnId);
    if (cached !== null) {
      return NextResponse.json({ text: cached });
    }
  }

  const missionModel = await getModelForGroup("B");
  let ai;
  try {
    ai = createGenAIClient(missionModel);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
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

지금 아이에게 자연스럽게 이어서 물어봐야 할 다음 질문은 "${nextQuestionText}"예요. 이 질문의 요지를 반드시 살려서 자연스럽게 물어보세요.
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

    let text = (result.text ?? "").trim();
    if (!text || containsPromptLeak(text)) {
      // 빈 응답이거나 프롬프트 누출 흔적이 있으면 일부만 잘라 쓰지 않고 응답 전체를
      // 폐기한다 — 안전한 고정 리액션 + 순정 다음 질문 텍스트로 완전히 대체.
      console.warn("[mission/respond] discarding leaked/empty model response, falling back to safe text");
      text = `그렇구나! ${nextQuestionText}`;
    }
    if (childTurnId) setCachedRespond(childTurnId, text);

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
