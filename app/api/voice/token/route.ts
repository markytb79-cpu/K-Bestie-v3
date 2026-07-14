import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getModelForGroup } from "@/app/api/_lib/ai";
import { K_SYSTEM_PROMPT } from "@/app/api/_lib/prompts";

export const runtime = "nodejs";

// TODO: Tier3 하루 사용시간 상한(cap) 체크를 여기 추가할 것 — 자세한 건 FUTURE_TODO.md 참고.
export async function POST() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
  }

  // 그룹C(라이브) 스위치 조회 — 연결 시작 시점에 1회 스냅샷되어 세션 수명 동안 고정된다
  // (클라이언트 useGeminiLive.startSession()이 매 연결마다 이 라우트를 새로 호출하므로,
  // 이미 연결된 세션은 관리자가 스위치를 바꿔도 영향받지 않고 다음 연결부터 반영됨).
  const voiceModel = await getModelForGroup("C");
  // TODO(follow-up): Vertex Live 오디오는 AI Studio의 ephemeral authTokens 메커니즘과
  // 인증 방식이 완전히 다른 WebSocket 릴레이가 필요해 이번 스코프에서는 미구현.
  // 그룹C가 Vertex로 전환돼도 라이브 연결만은 AI Studio 모델로 안전하게 유지한다.
  const liveModelId = voiceModel.provider === "vertex" ? "gemini-3.1-flash-live-preview" : voiceModel.modelId;

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
        model: liveModelId,
        config: {
          systemInstruction: { parts: [{ text: K_SYSTEM_PROMPT }] },
        },
      },
      lockAdditionalFields: [],
    },
  });

  return NextResponse.json({
    token: token.name,
    model: liveModelId,
    expiresAt: expireTime,
  });
}
