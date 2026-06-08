/**
 * Gemini Live API + Gemma generateContent 최소 연결 테스트
 * 실행: node test-gemini.mjs
 */
import { readFileSync } from "fs";
import { GoogleGenAI, Modality } from "@google/genai";

// ── .env.local 파싱 ───────────────────────────────────────────
function loadEnvLocal() {
  try {
    const lines = readFileSync(".env.local", "utf-8").split("\n");
    const env = {};
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const idx = t.indexOf("=");
      if (idx === -1) continue;
      const key = t.slice(0, idx).trim();
      let val = t.slice(idx + 1).trim();
      if (/^["']/.test(val) && val[0] === val.at(-1)) val = val.slice(1, -1);
      env[key] = val;
    }
    return env;
  } catch {
    return {};
  }
}

const env = loadEnvLocal();
const GEMINI_KEY = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const GEMMA_KEY  = env.GEMMA_API_KEY  || process.env.GEMMA_API_KEY || GEMINI_KEY;

if (!GEMINI_KEY) {
  console.error("❌  GEMINI_API_KEY not found in .env.local");
  process.exit(1);
}

console.log(`🔑  GEMINI_API_KEY : ${GEMINI_KEY.slice(0, 8)}...`);
console.log(`🔑  GEMMA_API_KEY  : ${GEMMA_KEY === GEMINI_KEY ? "(same as GEMINI_API_KEY)" : GEMMA_KEY.slice(0, 8) + "..."}`);

// ── 1. Gemini Live API 테스트 ─────────────────────────────────
async function testLive() {
  console.log("\n══════════════════════════════════════════════════════");
  console.log("[1] Gemini Live API — gemini-2.5-flash-native-audio-latest");
  console.log("══════════════════════════════════════════════════════");

  const ai = new GoogleGenAI({
    apiKey: GEMINI_KEY,
    httpOptions: { apiVersion: "v1alpha" },
  });

  let responseText = "";
  let closeCode = null;
  let closeReason = "";

  // Promise로 응답/종료 대기
  const done = new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.log("⏱️   타임아웃 (15s) — 응답 없음");
      resolve("timeout");
    }, 15000);

    ai.live.connect({
      model: "gemini-2.5-flash-native-audio-latest",
      config: {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {},
      },
      callbacks: {
        onopen: () => {
          console.log("✅  WebSocket 연결됨");
        },
        onmessage: (msg) => {
          // 오디오 프레임은 무시, 트랜스크립션만 수집
          const transcript = msg.serverContent?.outputTranscription?.text;
          if (transcript) {
            process.stdout.write(`💬  케이: ${transcript}`);
            responseText += transcript;
          }
          if (msg.serverContent?.turnComplete) {
            if (responseText) process.stdout.write("\n");
            clearTimeout(timer);
            resolve("ok");
          }
        },
        onerror: (e) => {
          console.error(`❌  WebSocket 에러: ${e.message ?? e}`);
        },
        onclose: (e) => {
          closeCode   = e.code;
          closeReason = e.reason ?? "";
          if (e.code === 1000) {
            console.log(`🔌  정상 종료 (code 1000)`);
          } else {
            console.error(`\n🚨  비정상 종료`);
            console.error(`    code   : ${e.code}`);
            console.error(`    reason : "${closeReason || "(없음)"}"`);
            if (e.code === 1011) {
              console.error("    → 1011 = 서버 내부 에러 (모델 미지원 / 요금 / 지역 제한 가능성)");
            }
          }
          clearTimeout(timer);
          resolve("closed");
        },
      },
    }).then((session) => {
      // connect() resolve 시점에 WebSocket이 열려 있음
      console.log(`📤  전송: "안녕"`);
      session.sendClientContent({
        turns: [{ role: "user", parts: [{ text: "안녕" }] }],
        turnComplete: true,
      });
    }).catch((err) => {
      console.error(`❌  connect() 실패: ${err.message}`);
      clearTimeout(timer);
      resolve("error");
    });
  });

  const result = await done;
  console.log(`\n결과: ${result} | closeCode=${closeCode ?? "N/A"} | 응답길이=${responseText.length}자`);
  return { result, closeCode, closeReason, responseText };
}

// ── 2. generateContent (Gemma) 테스트 ────────────────────────
async function testGenerateContent() {
  console.log("\n══════════════════════════════════════════════════════");
  console.log("[2] generateContent — gemma-4-31b-it (GEMMA_API_KEY)");
  console.log("══════════════════════════════════════════════════════");

  const ai = new GoogleGenAI({ apiKey: GEMMA_KEY });

  try {
    console.log('📤  전송: "안녕이라고 짧게 답해줘"');
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",         // 키 동작 확인용
      contents: [{ role: "user", parts: [{ text: "안녕이라고 짧게 답해줘" }] }],
    });
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? result.text ?? "(텍스트 없음)";
    console.log(`✅  응답: "${text.trim()}"`);
  } catch (err) {
    console.error(`❌  실패: ${err.message}`);
    if (err.message?.includes("404") || err.message?.includes("not found")) {
      console.error("    → 모델명 오류 또는 API 버전 불일치");
    } else if (err.message?.includes("403") || err.message?.includes("permission")) {
      console.error("    → API 키 권한 부족 또는 키 불일치");
    }
  }
}

// ── 실행 ─────────────────────────────────────────────────────
await testLive();
await testGenerateContent();
console.log("\n══════════════════════════════════════════════════════");
console.log("테스트 완료");
console.log("══════════════════════════════════════════════════════");
