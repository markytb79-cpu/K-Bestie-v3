import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveReportModel } from "@/app/api/_lib/ai";
import { REPORT_PROMPT_TEMPLATE } from "@/app/api/_lib/prompts";
import type { Turn } from "@/hooks/useGeminiLive";

export const runtime = "nodejs";

interface RequestBody {
  sessionId: string;
  transcript: Turn[];
}

export async function POST(req: NextRequest) {
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

  const supabase = createServiceClient();
  const reportModel = getActiveReportModel();

  // 1. 세션 종료 시각 + 턴 수 업데이트
  const turnCount = transcript.filter((t) => t.role === "child").length;
  await supabase
    .from("chat_sessions")
    .update({ ended_at: new Date().toISOString(), turn_count: turnCount })
    .eq("id", sessionId);

  // chat_messages는 /api/chat/messages 엔드포인트로 실시간 저장됨 — 여기서 중복 INSERT 생략

  // 트랜스크립트가 없으면 리포트 스킵
  if (transcript.length === 0) {
    return NextResponse.json({ reportId: null, skipped: true });
  }

  // 3. Gemma로 리포트 생성
  const transcriptText = transcript
    .map((t) => `${t.role === "child" ? "아이" : "케이"}: ${t.text}`)
    .join("\n");
  const prompt = REPORT_PROMPT_TEMPLATE.replace("{{TRANSCRIPT}}", transcriptText);

  const ai = new GoogleGenAI({ apiKey: process.env.GEMMA_API_KEY! });
  const result = await ai.models.generateContent({
    model: reportModel.modelId,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: reportModel.maxOutputTokens,
    },
  });

  let report: { summary_line: string; mood_score: number; emotion_tags: string[]; parent_guide: string };
  try {
    const raw = result.text ?? "{}";
    report = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Gemma returned invalid JSON", raw: result.text }, { status: 500 });
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
    })
    .select("id")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ reportId: inserted.id, report });
}
