import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CHILD_SPEECH_HINTS, CHILD_SPEECH_HINT_BOOST } from "@/lib/stt/childSpeechHints";

export const runtime = "nodejs";

interface SpeechResponse {
  results?: Array<{ alternatives?: Array<{ transcript?: string }> }>;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GCP_STT_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "STT not configured" }, { status: 500 });
  }

  let body: { audioBase64?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const audioBase64 = body.audioBase64;
  if (!audioBase64 || typeof audioBase64 !== "string") {
    return NextResponse.json({ error: "audioBase64 required" }, { status: 400 });
  }

  try {
    const gcpRes = await fetch(
      `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            encoding: "LINEAR16",
            sampleRateHertz: 16000,
            languageCode: "ko-KR",
            model: "default",
            audioChannelCount: 1,
            enableAutomaticPunctuation: true,
            speechContexts: [{ phrases: CHILD_SPEECH_HINTS, boost: CHILD_SPEECH_HINT_BOOST }],
          },
          audio: { content: audioBase64 },
        }),
      }
    );

    if (!gcpRes.ok) {
      // 응답 바디에 API 키가 섞여있을 수 있으므로 그대로 노출하지 않음
      console.error("[mission/stt] GCP STT failed:", gcpRes.status);
      return NextResponse.json({ error: "STT request failed" }, { status: 500 });
    }

    const data = (await gcpRes.json()) as SpeechResponse;
    const transcript = (data.results ?? [])
      .map((r) => r.alternatives?.[0]?.transcript ?? "")
      .join("")
      .trim();

    return NextResponse.json({ transcript });
  } catch (err) {
    console.error("[mission/stt] error:", (err as Error).message);
    return NextResponse.json({ error: "STT request failed" }, { status: 500 });
  }
}
