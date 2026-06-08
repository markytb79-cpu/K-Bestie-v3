import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getActiveVoiceModel } from "@/app/api/_lib/ai";
import { K_SYSTEM_PROMPT } from "@/app/api/_lib/prompts";

export const runtime = "nodejs";

export async function POST() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
  }

  const voiceModel = getActiveVoiceModel();

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "v1alpha" },
  });

  const expireTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // 토큰에는 보안 필수 항목만 잠금 (model + systemInstruction)
  // responseModalities / transcription 은 브라우저 connect 시 전달
  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      expireTime,
      liveConnectConstraints: {
        model: voiceModel.modelId,
        config: {
          systemInstruction: { parts: [{ text: K_SYSTEM_PROMPT }] },
        },
      },
    },
  });

  return NextResponse.json({
    token: token.name,
    model: voiceModel.modelId,
    expiresAt: expireTime,
  });
}
