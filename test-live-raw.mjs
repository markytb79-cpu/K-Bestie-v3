/**
 * Live API raw message 구조 진단
 * 실행: node test-live-raw.mjs
 */
import { readFileSync } from "fs";
import { GoogleGenAI, Modality } from "@google/genai";

function loadEnv() {
  try {
    return Object.fromEntries(
      readFileSync(".env.local","utf-8").split("\n")
        .filter(l => l.includes("=") && !l.startsWith("#"))
        .map(l => { const i=l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")]; })
    );
  } catch { return {}; }
}
const env = loadEnv();
const KEY = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
if (!KEY) { console.error("GEMINI_API_KEY not found"); process.exit(1); }

const ai = new GoogleGenAI({ apiKey: KEY, httpOptions: { apiVersion: "v1alpha" } });

let msgCount = 0;
const done = new Promise(resolve => {
  const timer = setTimeout(() => { console.log("\n⏱️  타임아웃 15s"); resolve(); }, 15000);

  ai.live.connect({
    model: "gemini-2.5-flash-native-audio-latest",
    config: {
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
    callbacks: {
      onopen: () => console.log("✅ connected"),
      onmessage: (msg) => {
        msgCount++;
        // msg.data getter 결과
        console.log(`\n─── msg #${msgCount} ───`);
        console.log("msg.data (getter):", msg.data === undefined ? "UNDEFINED" : typeof msg.data);

        // raw 필드 목록
        const keys = Object.keys(msg);
        console.log("top-level keys:", keys);

        // serverContent 구조 전체 출력 (오디오 data는 잘라서)
        if (msg.serverContent) {
          const sc = JSON.parse(JSON.stringify(msg.serverContent));
          // inlineData.data 는 너무 길어서 축약
          const truncate = (obj) => {
            if (!obj || typeof obj !== "object") return obj;
            if (Array.isArray(obj)) return obj.map(truncate);
            const out = {};
            for (const [k,v] of Object.entries(obj)) {
              if (k === "data" && typeof v === "string" && v.length > 20)
                out[k] = v.slice(0,20) + "…("+v.length+"chars)";
              else out[k] = truncate(v);
            }
            return out;
          };
          console.log("serverContent:", JSON.stringify(truncate(sc), null, 2));
        }

        // turnComplete 오면 텍스트 전송
        if (msgCount === 1) {
          console.log("\n📤 '안녕' 전송");
          // session은 아래 .then()에서 참조
        }
        if (msg.serverContent?.turnComplete && msgCount > 2) {
          clearTimeout(timer);
          resolve();
        }
      },
      onerror: (e) => console.error("❌", e.message),
      onclose: (e) => { console.log("🔌 close", e.code, e.reason||""); clearTimeout(timer); resolve(); },
    },
  }).then(session => {
    session.sendClientContent({
      turns: [{ role: "user", parts: [{ text: "안녕" }] }],
      turnComplete: true,
    });
  });
});

await done;
console.log(`\n총 ${msgCount}개 메시지 수신`);
