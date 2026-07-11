import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// 일반 Cloud Text-to-Speech Wavenet 보이스만 사용한다.
// Gemini 계열 TTS(토큰 과금, 매우 비쌈)는 절대 쓰지 않는다 — text:synthesize REST 고정.
const TTS_VOICE_NAME = "ko-KR-Wavenet-A"; // 케이(밝고 친근한 톤)

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GCP_TTS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "TTS not configured" }, { status: 500 });
  }

  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  try {
    const gcpRes = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: "ko-KR", name: TTS_VOICE_NAME },
          audioConfig: { audioEncoding: "MP3", speakingRate: 1.02, pitch: 1.0 },
        }),
      }
    );

    if (!gcpRes.ok) {
      console.error("[voice/tts] GCP TTS failed:", gcpRes.status);
      return NextResponse.json({ error: "TTS request failed" }, { status: 500 });
    }

    const data = (await gcpRes.json()) as { audioContent?: string };
    if (!data.audioContent) {
      return NextResponse.json({ error: "TTS returned no audio" }, { status: 500 });
    }

    return NextResponse.json({ audioContent: data.audioContent, mimeType: "audio/mp3" });
  } catch (err) {
    console.error("[voice/tts] error:", (err as Error).message);
    return NextResponse.json({ error: "TTS request failed" }, { status: 500 });
  }
}
