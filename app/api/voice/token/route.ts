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
  // responseModalities / transcription / speechConfig 은 브라우저 connect 시 전달
  // lockAdditionalFields: [] 필수 — 없으면(undefined) LiveConnectConfig 전체가 잠겨
  // connect() 시 클라이언트가 보내는 추가 필드(responseModalities 등)가 거부되어 1011로 끊긴다.
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
      lockAdditionalFields: [],
    },
  });

  return NextResponse.json({
    token: token.name,
    model: voiceModel.modelId,
    expiresAt: expireTime,
  });
}
