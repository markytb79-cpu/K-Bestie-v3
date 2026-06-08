import { GoogleGenAI } from "@google/genai";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveReportModel } from "@/app/api/_lib/ai";
import { WEEKLY_SUMMARY_PROMPT_TEMPLATE } from "@/app/api/_lib/prompts";

export interface WeeklySummaryResult {
  created: string[];  // 생성된 weekly_summary id 목록
  skipped: string[];  // 데이터 없어서 건너뜀 (child_id)
  errors: { childId: string; error: string }[];
}

/** targetDate(월~일) 주의 월요일/일요일 DATE 문자열 반환 */
function getWeekBounds(targetDate: string): { weekStart: string; weekEnd: string } {
  const d = new Date(`${targetDate}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0=일, 1=월 … 6=토
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() + diffToMon);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
  return { weekStart: fmt(mon), weekEnd: fmt(sun) };
}

/**
 * Step 3: 주간 요약 생성
 *
 * targetDate가 일요일이거나 forceWeekly=true 일 때 실행.
 * 해당 주(월~일) 동안 생성된 daily_reports를 child_id별로 묶어
 * weekly_summaries에 삽입한다.
 *
 * @param targetDate  "YYYY-MM-DD"
 * @param forceWeekly 요일 무관 강제 실행
 */
export async function generateWeeklySummary(
  targetDate: string,
  forceWeekly = false,
): Promise<WeeklySummaryResult> {
  const result: WeeklySummaryResult = { created: [], skipped: [], errors: [] };

  // 일요일(0)이 아니면 skip (forceWeekly로 override 가능)
  const dow = new Date(`${targetDate}T12:00:00Z`).getUTCDay();
  if (!forceWeekly && dow !== 0) return result;

  const { weekStart, weekEnd } = getWeekBounds(targetDate);

  const db = createServiceClient();

  // 해당 주에 생성된 daily_reports + child_id (chat_sessions 조인)
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

  if (fetchErr) {
    throw new Error(`generateWeeklySummary: 리포트 조회 실패 — ${fetchErr.message}`);
  }
  if (!reports?.length) return result;

  // child_id별로 그룹핑
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

  const reportModel = getActiveReportModel();
  const ai = new GoogleGenAI({ apiKey: process.env.GEMMA_API_KEY! });
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

      const genResult = await ai.models.generateContent({
        model: reportModel.modelId,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: 1024,
        },
      });

      let summary: {
        summary_text: string;
        mood_average: number;
        highlights: string[];
        parent_guide: string;
      };
      try {
        summary = JSON.parse(genResult.text ?? "{}");
      } catch {
        throw new Error(`JSON 파싱 실패: ${genResult.text?.slice(0, 100)}`);
      }

      summary.mood_average = Math.max(1, Math.min(10,
        Math.round((summary.mood_average ?? 5) * 10) / 10
      ));

      const { data: inserted, error: insertErr } = await db
        .from("weekly_summaries")
        .upsert(
          {
            child_id: childId,
            week_start: weekStart,
            week_end: weekEnd,
            summary_text: summary.summary_text ?? "",
            mood_average: summary.mood_average,
            highlights: summary.highlights ?? [],
            parent_guide: summary.parent_guide ?? "",
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
