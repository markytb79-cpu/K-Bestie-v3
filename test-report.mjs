/**
 * 리포트 생성 E2E 테스트
 * - gemma-4-31b-it 로 실제 generateContent 호출
 * - daily_reports INSERT 까지 검증
 * - 테스트용 더미 레코드는 완료 후 자동 삭제
 * 실행: node test-report.mjs
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";

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
const GEMMA_KEY    = env.GEMMA_API_KEY    || env.GEMINI_API_KEY || process.env.GEMMA_API_KEY;
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!GEMMA_KEY)    { console.error("❌  GEMMA_API_KEY / GEMINI_API_KEY not found"); process.exit(1); }
if (!SUPABASE_URL) { console.error("❌  NEXT_PUBLIC_SUPABASE_URL not found");         process.exit(1); }
if (!SERVICE_KEY)  { console.error("❌  SUPABASE_SERVICE_ROLE_KEY not found");         process.exit(1); }

console.log(`🔑  Gemma key   : ${GEMMA_KEY.slice(0, 8)}...`);
console.log(`🗄️   Supabase URL: ${SUPABASE_URL}`);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const ai = new GoogleGenAI({ apiKey: GEMMA_KEY });

// ── 리포트 프롬프트 (실제 코드와 동일) ───────────────────────
const REPORT_PROMPT_TEMPLATE = `
다음은 아이와 AI 친구 '케이'의 대화 내용입니다.
부모님께 전달할 요약 리포트를 아래 JSON 형식으로 작성해주세요.

대화 내용:
{{TRANSCRIPT}}

반환 형식 (JSON만, 다른 텍스트 없이):
{
  "summary_line": "오늘 대화를 한 문장으로 요약 (20자 이내)",
  "mood_score": 1~10 정수 (1=매우 슬픔, 5=보통, 10=매우 즐거움),
  "emotion_tags": ["감정 키워드 최대 3개"],
  "parent_guide": "부모님께 드리는 짧은 조언 (40자 이내, 없으면 빈 문자열)"
}
`.trim();

// ── 더미 대화 내용 ────────────────────────────────────────────
const DUMMY_TRANSCRIPT = [
  { role: "child", text: "케이야 나 오늘 학교에서 친구랑 싸웠어" },
  { role: "k",     text: "어머, 그랬구나. 많이 속상했겠다. 어떤 일이 있었어?" },
  { role: "child", text: "짝꿍이 내 지우개 물어보지도 않고 가져갔어. 화가 났어" },
  { role: "k",     text: "그건 기분 나쁠 수 있지. 그래서 어떻게 했어?" },
  { role: "child", text: "내가 돌려달라고 했더니 친구가 미안하다고 했어" },
  { role: "k",     text: "잘 해결했네! 용기 내서 말한 거 정말 잘했어." },
];

let testChildId  = null;
let testSessionId = null;

async function cleanup() {
  if (testSessionId) {
    await supabase.from("daily_reports").delete().eq("session_id", testSessionId);
    await supabase.from("chat_sessions").delete().eq("id", testSessionId);
  }
  if (testChildId) {
    await supabase.from("pending_children").delete().eq("id", testChildId);
  }
}

// ── Step 1: 테스트용 더미 레코드 생성 ────────────────────────
console.log("\n══════════════════════════════════════════════════════");
console.log("Step 1 — 테스트 레코드 생성 (pending_children + chat_sessions)");
console.log("══════════════════════════════════════════════════════");

const { data: child, error: childErr } = await supabase
  .from("pending_children")
  .insert({ name: "__TEST__", grade: 2, interests: ["테스트"] })
  .select("id")
  .single();

if (childErr) {
  console.error(`❌  pending_children INSERT 실패: ${childErr.message}`);
  console.error("    힌트: DB 스키마가 아직 적용되지 않았을 수 있습니다.");
  process.exit(1);
}
testChildId = child.id;
console.log(`✅  테스트 아이 생성: id=${testChildId}`);

const { data: session, error: sessionErr } = await supabase
  .from("chat_sessions")
  .insert({ child_id: testChildId })
  .select("id")
  .single();

if (sessionErr) {
  console.error(`❌  chat_sessions INSERT 실패: ${sessionErr.message}`);
  await cleanup();
  process.exit(1);
}
testSessionId = session.id;
console.log(`✅  테스트 세션 생성: id=${testSessionId}`);

// ── Step 2: Gemma 호출 ────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════");
console.log("Step 2 — Gemma generateContent (gemma-4-31b-it)");
console.log("══════════════════════════════════════════════════════");

const transcriptText = DUMMY_TRANSCRIPT
  .map((t) => `${t.role === "child" ? "아이" : "케이"}: ${t.text}`)
  .join("\n");

console.log("📋  더미 대화:\n" + transcriptText.split("\n").map(l => "    " + l).join("\n"));

const prompt = REPORT_PROMPT_TEMPLATE.replace("{{TRANSCRIPT}}", transcriptText);

let rawText = "";
let report  = null;

try {
  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 1024,
    },
  });

  rawText = result.candidates?.[0]?.content?.parts?.[0]?.text ?? result.text ?? "";
  console.log(`\n📤  Gemma 원본 응답:\n${rawText}`);

  // JSON 파싱 (코드블록 감싸인 경우 제거)
  const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  report = JSON.parse(cleaned);

  // mood_score 범위 보정
  report.mood_score = Math.max(1, Math.min(10, Math.round(report.mood_score ?? 5)));

  console.log("\n✅  파싱 성공:");
  console.log(`    summary_line  : "${report.summary_line}"`);
  console.log(`    mood_score    : ${report.mood_score}`);
  console.log(`    emotion_tags  : [${(report.emotion_tags ?? []).join(", ")}]`);
  console.log(`    parent_guide  : "${report.parent_guide}"`);
} catch (err) {
  console.error(`\n❌  Gemma 호출/파싱 실패: ${err.message}`);
  if (rawText) console.error(`    원본 응답: ${rawText}`);
  await cleanup();
  process.exit(1);
}

// ── Step 3: daily_reports INSERT ─────────────────────────────
console.log("\n══════════════════════════════════════════════════════");
console.log("Step 3 — daily_reports INSERT");
console.log("══════════════════════════════════════════════════════");

const { data: inserted, error: insertErr } = await supabase
  .from("daily_reports")
  .insert({
    session_id   : testSessionId,
    summary_line : report.summary_line ?? "",
    mood_score   : report.mood_score,
    emotion_tags : report.emotion_tags ?? [],
    parent_guide : report.parent_guide ?? "",
  })
  .select("id, created_at")
  .single();

if (insertErr) {
  console.error(`❌  daily_reports INSERT 실패: ${insertErr.message}`);
  await cleanup();
  process.exit(1);
}

console.log(`✅  daily_reports 저장 완료`);
console.log(`    id         : ${inserted.id}`);
console.log(`    created_at : ${inserted.created_at}`);

// ── Step 4: 저장 내용 재조회 확인 ────────────────────────────
console.log("\n══════════════════════════════════════════════════════");
console.log("Step 4 — 저장 내용 재조회");
console.log("══════════════════════════════════════════════════════");

const { data: fetched, error: fetchErr } = await supabase
  .from("daily_reports")
  .select("*")
  .eq("id", inserted.id)
  .single();

if (fetchErr) {
  console.error(`❌  조회 실패: ${fetchErr.message}`);
} else {
  console.log("✅  DB 조회 성공:");
  console.log(`    ${JSON.stringify(fetched, null, 2).split("\n").join("\n    ")}`);
}

// ── 정리 ─────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════");
console.log("정리 — 테스트 데이터 삭제");
console.log("══════════════════════════════════════════════════════");
await cleanup();
console.log("✅  테스트 데이터 삭제 완료");
console.log("\n🎉  모든 단계 통과");
