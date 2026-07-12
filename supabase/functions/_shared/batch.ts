// Supabase Edge Function 공용 배치 로직 (Deno 런타임)
//
// TODO: 대화 내역(chat_messages) 7일 경과 자동 파기 스텝 추가 필요 — 자세한 건 FUTURE_TODO.md 참고.
//
// ⚠️ 운영 스케줄의 소스오브트루스 = 이 Edge Function 코드.
//    Next.js 쪽 lib/batch/*.ts + app/api/batch/daily/route.ts 는 로컬 수동 테스트 전용이며
//    운영 크론 경로가 아니다. 로직 변경 시 양쪽을 함께 맞춰야 한다.
//
// 프롬프트/모델 설정은 Next 쪽 순수 모듈을 그대로 재사용(중복 방지):
//   - app/api/_lib/prompts.ts  (REPORT_PROMPT_TEMPLATE, WEEKLY_SUMMARY_PROMPT_TEMPLATE)
//   - app/api/_lib/ai.ts       (getActiveReportModel)
// 두 파일은 외부 import가 없는 순수 TS라 Deno에서 그대로 import 가능하다.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  REPORT_PROMPT_TEMPLATE,
  WEEKLY_SUMMARY_PROMPT_TEMPLATE,
} from "../../../app/api/_lib/prompts.ts";
import { getActiveReportModel } from "../../../app/api/_lib/ai.ts";

const DASHBOARD_KEYS = [
  "school_life",
  "peer_relations",
  "interests",
  "study_concerns",
  "digital_interests",
  "future_dreams",
  "recurring_stories",
] as const;

export interface CloseResult {
  closed: string[];
  skipped: string[];
  errors: { sessionId: string; error: string }[];
}
export interface DailyReportResult {
  created: string[];
  skipped: string[];
  errors: { sessionId: string; error: string }[];
}
export interface WeeklySummaryResult {
  created: string[];
  skipped: string[];
  errors: { childId: string; error: string }[];
}

export function serviceClient(): SupabaseClient {
  // SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 Edge Function 런타임이 자동 주입
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Gemini/Gemma REST 직접 호출 (Deno에서 @google/genai 대신 fetch 사용) */
async function callReportModel(prompt: string, maxOutputTokens: number): Promise<string> {
  const model = getActiveReportModel();
  const apiKey = Deno.env.get("GEMMA_API_KEY")!;
  const res = await fetch(
    `${model.apiBase}/v1beta/models/${model.modelId}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens,
        },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
}

/** Step 1: 자유 대화 세션 마감 */
export async function closeFreeSessions(db: SupabaseClient, targetDate: string): Promise<CloseResult> {
  const result: CloseResult = { closed: [], skipped: [], errors: [] };

  const { data: sessions, error: fetchErr } = await db
    .from("chat_sessions")
    .select("id, started_at")
    .eq("session_type", "free")
    .is("ended_at", null)
    .lte("started_at", `${targetDate}T23:59:59+09:00`);

  if (fetchErr) throw new Error(`closeFreeSessions: 세션 조회 실패 — ${fetchErr.message}`);
  if (!sessions?.length) return result;

  for (const session of sessions) {
    try {
      const { data: lastMsg } = await db
        .from("chat_messages")
        .select("created_at")
        .eq("session_id", session.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const endedAt = lastMsg?.created_at ?? session.started_at;

      const { error: updateErr } = await db
        .from("chat_sessions")
        .update({ ended_at: endedAt })
        .eq("id", session.id);

      if (updateErr) throw new Error(updateErr.message);
      result.closed.push(session.id);
    } catch (e) {
      result.errors.push({ sessionId: session.id, error: String(e) });
    }
  }
  return result;
}

/** Step 2: 일일 리포트 생성 (emotion_level + dashboard_cards 포함) */
export async function generateDailyReports(db: SupabaseClient, targetDate: string): Promise<DailyReportResult> {
  const result: DailyReportResult = { created: [], skipped: [], errors: [] };

  const { data: sessions, error: fetchErr } = await db
    .from("chat_sessions")
    .select("id, child_id")
    .gte("ended_at", `${targetDate}T00:00:00+09:00`)
    .lte("ended_at", `${targetDate}T23:59:59+09:00`)
    .not("id", "in", `(SELECT session_id FROM daily_reports)`);

  if (fetchErr) throw new Error(`generateDailyReports: 세션 조회 실패 — ${fetchErr.message}`);
  if (!sessions?.length) return result;

  const reportModel = getActiveReportModel();

  for (const session of sessions) {
    try {
      const { data: messages, error: msgErr } = await db
        .from("chat_messages")
        .select("role, content")
        .eq("session_id", session.id)
        .order("created_at", { ascending: true });

      if (msgErr) throw new Error(msgErr.message);
      if (!messages?.length) {
        result.skipped.push(session.id);
        continue;
      }

      const transcriptText = messages
        .map((m: { role: string; content: string }) => `${m.role === "child" ? "아이" : "케이"}: ${m.content}`)
        .join("\n");
      const prompt = REPORT_PROMPT_TEMPLATE.replace("{{TRANSCRIPT}}", transcriptText);

      const text = await callReportModel(prompt, reportModel.maxOutputTokens);

      let report: {
        summary_line?: string;
        mood_score?: number;
        emotion_tags?: string[];
        parent_guide?: string;
        emotion_level?: string;
        dashboard_cards?: Record<string, string>;
      };
      try {
        report = JSON.parse(text);
      } catch {
        throw new Error(`JSON 파싱 실패: ${text.slice(0, 100)}`);
      }

      const moodScore = Math.max(1, Math.min(10, Math.round(report.mood_score ?? 5)));
      const emotionLevel =
        report.emotion_level === "warning" || report.emotion_level === "danger"
          ? report.emotion_level
          : "safe";
      const rawCards = report.dashboard_cards ?? {};
      const dashboardCards = Object.fromEntries(
        DASHBOARD_KEYS.map((k) => [k, typeof rawCards[k] === "string" ? rawCards[k] : ""]),
      );

      const { data: inserted, error: insertErr } = await db
        .from("daily_reports")
        .insert({
          session_id: session.id,
          summary_line: report.summary_line ?? "",
          mood_score: moodScore,
          emotion_tags: report.emotion_tags ?? [],
          parent_guide: report.parent_guide ?? "",
          emotion_level: emotionLevel,
          dashboard_cards: dashboardCards,
        })
        .select("id")
        .single();

      if (insertErr) throw new Error(insertErr.message);
      result.created.push(inserted.id);
    } catch (e) {
      result.errors.push({ sessionId: session.id, error: String(e) });
    }
  }
  return result;
}

/** targetDate가 속한 주의 월요일/일요일 DATE 문자열 */
function getWeekBounds(targetDate: string): { weekStart: string; weekEnd: string } {
  const d = new Date(`${targetDate}T12:00:00Z`);
  const dow = d.getUTCDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() + diffToMon);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
  return { weekStart: fmt(mon), weekEnd: fmt(sun) };
}

/** Step 3: 주간 요약 (weekend_activity_recommendation 포함). 토요일(6) 또는 forceWeekly */
export async function generateWeeklySummary(
  db: SupabaseClient,
  targetDate: string,
  forceWeekly = false,
): Promise<WeeklySummaryResult> {
  const result: WeeklySummaryResult = { created: [], skipped: [], errors: [] };

  const dow = new Date(`${targetDate}T12:00:00Z`).getUTCDay();
  if (!forceWeekly && dow !== 6) return result;

  const { weekStart, weekEnd } = getWeekBounds(targetDate);

  const { data: reports, error: fetchErr } = await db
    .from("daily_reports")
    .select(`
      id,
      summary_line,
      mood_score,
      emotion_tags,
      parent_guide,
      chat_sessions!inner ( child_id )
    `)
    .gte("created_at", `${weekStart}T00:00:00Z`)
    .lte("created_at", `${weekEnd}T23:59:59Z`);

  if (fetchErr) throw new Error(`generateWeeklySummary: 리포트 조회 실패 — ${fetchErr.message}`);
  if (!reports?.length) return result;

  type ReportRow = {
    id: string;
    summary_line: string;
    mood_score: number;
    emotion_tags: string[];
    parent_guide: string;
    chat_sessions: { child_id: string } | { child_id: string }[];
  };

  const byChild = new Map<string, ReportRow[]>();
  for (const r of reports as ReportRow[]) {
    const sess = Array.isArray(r.chat_sessions) ? r.chat_sessions[0] : r.chat_sessions;
    const childId = sess?.child_id;
    if (!childId) continue;
    if (!byChild.has(childId)) byChild.set(childId, []);
    byChild.get(childId)!.push(r);
  }

  const weekRange = `${weekStart} ~ ${weekEnd}`;

  for (const [childId, childReports] of byChild) {
    try {
      if (!childReports.length) {
        result.skipped.push(childId);
        continue;
      }

      const dailySummaries = childReports
        .map((r, i) => `Day ${i + 1}: ${r.summary_line} (기분 ${r.mood_score}/10, 태그: ${r.emotion_tags.join(", ")})`)
        .join("\n");

      const prompt = WEEKLY_SUMMARY_PROMPT_TEMPLATE
        .replace("{{WEEK_RANGE}}", weekRange)
        .replace("{{DAILY_SUMMARIES}}", dailySummaries);

      const text = await callReportModel(prompt, 1024);

      let summary: {
        summary_text?: string;
        mood_average?: number;
        highlights?: string[];
        parent_guide?: string;
        weekend_activity_recommendation?: string;
      };
      try {
        summary = JSON.parse(text);
      } catch {
        throw new Error(`JSON 파싱 실패: ${text.slice(0, 100)}`);
      }

      const moodAverage = Math.max(1, Math.min(10, Math.round((summary.mood_average ?? 5) * 10) / 10));

      const { data: inserted, error: insertErr } = await db
        .from("weekly_summaries")
        .upsert(
          {
            child_id: childId,
            week_start: weekStart,
            week_end: weekEnd,
            summary_text: summary.summary_text ?? "",
            mood_average: moodAverage,
            highlights: summary.highlights ?? [],
            parent_guide: summary.parent_guide ?? "",
            weekend_activity_recommendation: summary.weekend_activity_recommendation ?? "",
          },
          { onConflict: "child_id,week_start" },
        )
        .select("id")
        .single();

      if (insertErr) throw new Error(insertErr.message);
      result.created.push(inserted.id);
    } catch (e) {
      result.errors.push({ childId, error: String(e) });
    }
  }
  return result;
}

/** KST(UTC+9) 기준 오늘 날짜 YYYY-MM-DD */
export function kstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Authorization: Bearer <BATCH_SECRET> 검증. 통과 시 null, 실패 시 Response 반환 */
export function checkAuth(req: Request): Response | null {
  const secret = Deno.env.get("BATCH_SECRET");
  if (!secret) {
    return new Response(JSON.stringify({ error: "BATCH_SECRET not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
