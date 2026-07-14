import { NextRequest, NextResponse, after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getModelForGroup, createGenAIClient, createAIStudioFallbackClient } from "@/app/api/_lib/ai";
import { REPORT_PROMPT_TEMPLATE } from "@/app/api/_lib/prompts";
import { resolveUsageContext } from "@/lib/plan/voiceMode";
import { estimateCost } from "@/lib/plan/pricing";
import type { Turn } from "@/hooks/useGeminiLive";

export const runtime = "nodejs";

interface RequestBody {
  sessionId: string;
  transcript: Turn[];
}

export async function POST(req: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sessionId, transcript } = body;
  if (!sessionId || !Array.isArray(transcript)) {
    return NextResponse.json({ error: "sessionId and transcript required" }, { status: 400 });
  }

  const { data: session, error: sessionError } = await authClient
    .from("chat_sessions")
    .select("id")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const supabase = createServiceClient();
  const reportModel = await getModelForGroup("A");

  // 1. 세션 종료 시각 + 턴 수 업데이트
  const turnCount = transcript.filter((t) => t.role === "child").length;
  const { error: updateErr } = await supabase
    .from("chat_sessions")
    .update({ ended_at: new Date().toISOString(), turn_count: turnCount })
    .eq("id", sessionId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // chat_messages는 /api/chat/messages 엔드포인트로 실시간 저장됨 — 여기서 중복 INSERT 생략

  // 트랜스크립트가 없으면 리포트 스킵
  if (transcript.length === 0) {
    return NextResponse.json({ reportId: null, skipped: true });
  }

  // 3. 리포트 생성 (재시도 및 폴백 탑재)
  const transcriptText = transcript
    .map((t) => `${t.role === "child" ? "아이" : "케이"}: ${t.text}`)
    .join("\n");
  const prompt = REPORT_PROMPT_TEMPLATE.replace("{{TRANSCRIPT}}", transcriptText);

  let ai;
  try {
    ai = createGenAIClient(reportModel);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  let resultText = "";
  let success = false;
  let usedTokenIn: number | undefined;
  let usedTokenOut: number | undefined;
  const RETRY_DELAYS = [0, 3000, 5000];

  // 3-1. Gemma 4 모델로 재시도 루프
  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    const delay = RETRY_DELAYS[attempt];
    if (delay > 0) {
      console.log(`[report/generate] Waiting ${delay}ms before retry attempt ${attempt + 1}...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      console.log(`[report/generate] Trying model: ${reportModel.modelId} (Attempt ${attempt + 1}/${RETRY_DELAYS.length})`);
      const response = await ai.models.generateContent({
        model: reportModel.modelId,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: reportModel.maxOutputTokens,
        },
      });

      resultText = (response.text ?? "").trim();
      // JSON 문법 유효성 사전 검사
      JSON.parse(resultText);
      success = true;
      usedTokenIn = response.usageMetadata?.promptTokenCount;
      usedTokenOut = response.usageMetadata?.candidatesTokenCount;
      console.log(`[report/generate] Success with model: ${reportModel.modelId}`);
      break;
    } catch (err) {
      console.error(
        `[report/generate] Attempt ${attempt + 1} failed for ${reportModel.modelId}. Error:`,
        (err as Error).message
      );
    }
  }

  // 3-2. 실패 시 gemini-2.5-flash 모델로 폴백 — provider와 무관하게 항상 AI Studio로
  // 교차 회귀한다(Vertex 장애 시에도 서비스 연속성 확보).
  if (!success) {
    console.warn(`[report/generate] ${reportModel.modelId}(${reportModel.provider}) failed completely. Falling back to AI Studio gemini-2.5-flash...`);
    try {
      const fallbackAi = createAIStudioFallbackClient();
      const response = await fallbackAi.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: 1024,
        },
      });

      resultText = (response.text ?? "").trim();
      JSON.parse(resultText);
      success = true;
      usedTokenIn = response.usageMetadata?.promptTokenCount;
      usedTokenOut = response.usageMetadata?.candidatesTokenCount;
      console.log(`[report/generate] Success with fallback model: gemini-2.5-flash`);
    } catch (fallbackErr) {
      console.error(`[report/generate] Fallback model also failed:`, (fallbackErr as Error).message);
      return NextResponse.json({ error: "Gemma 4 and fallback model both failed to generate valid report" }, { status: 500 });
    }
  }

  // usage_events(kind='llm') 계측 — 응답 자체를 막지 않도록 after()로 비동기 처리.
  if (usedTokenIn != null && usedTokenOut != null) {
    const tokenIn = usedTokenIn;
    const tokenOut = usedTokenOut;
    after(async () => {
      try {
        const ctx = await resolveUsageContext(sessionId);
        if (!ctx) return;
        const service2 = createServiceClient();
        const estCostKrw = estimateCost({ kind: "llm", tokenIn, tokenOut });
        await service2.from("usage_events").insert({
          child_id: ctx.childId,
          tier: ctx.tier,
          voice_mode: ctx.voiceMode,
          kind: "llm",
          token_in: tokenIn,
          token_out: tokenOut,
          est_cost_krw: estCostKrw,
        });
      } catch (err) {
        console.error("[report/generate] usage_events insert failed:", (err as Error).message);
      }
    });
  }

  let report: {
    summary_line: string;
    mood_score: number;
    emotion_tags: string[];
    parent_guide: string;
    emotion_level?: string;
    dashboard_cards?: any;
  };
  try {
    report = JSON.parse(resultText);
  } catch {
    return NextResponse.json({ error: "Report JSON parsing failed", raw: resultText }, { status: 500 });
  }

  // mood_score 범위 보정
  report.mood_score = Math.max(1, Math.min(10, Math.round(report.mood_score ?? 5)));

  // 4. daily_reports 저장
  const { data: inserted, error: insertErr } = await supabase
    .from("daily_reports")
    .insert({
      session_id: sessionId,
      summary_line: report.summary_line ?? "",
      mood_score: report.mood_score,
      emotion_tags: report.emotion_tags ?? [],
      parent_guide: report.parent_guide ?? "",
      emotion_level: report.emotion_level ?? "safe",
      dashboard_cards: report.dashboard_cards ?? {},
    })
    .select("id")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ reportId: inserted.id, report });
}
