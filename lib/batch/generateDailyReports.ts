import { createServiceClient } from "@/lib/supabase/server";
import { getModelForGroup, createGenAIClient } from "@/app/api/_lib/ai";
import { REPORT_PROMPT_TEMPLATE } from "@/app/api/_lib/prompts";

export interface DailyReportResult {
  created: string[];  // 생성된 daily_report id 목록
  skipped: string[];  // 대화 없어서 건너뜀 (session_id)
  errors: { sessionId: string; error: string }[];
}

/**
 * Step 2: 일일 리포트 생성
 *
 * targetDate에 종료된(ended_at::date = targetDate) 모든 세션에 대해
 * daily_reports가 없으면 Gemini로 생성해 삽입한다.
 *
 * @param targetDate  "YYYY-MM-DD"
 */
export async function generateDailyReports(targetDate: string): Promise<DailyReportResult> {
  const db = createServiceClient();
  const result: DailyReportResult = { created: [], skipped: [], errors: [] };

  // targetDate에 종료된 세션 중 리포트 없는 것
  const { data: sessions, error: fetchErr } = await db
    .from("chat_sessions")
    .select("id, child_id")
    .gte("ended_at", `${targetDate}T00:00:00+09:00`)
    .lte("ended_at", `${targetDate}T23:59:59+09:00`)
    .not("id", "in", `(SELECT session_id FROM daily_reports)`);

  if (fetchErr) {
    throw new Error(`generateDailyReports: 세션 조회 실패 — ${fetchErr.message}`);
  }
  if (!sessions?.length) return result;

  const reportModel = await getModelForGroup("A");
  const ai = createGenAIClient(reportModel);

  for (const session of sessions) {
    try {
      // 메시지 가져오기
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
        .map((m) => `${m.role === "child" ? "아이" : "케이"}: ${m.content}`)
        .join("\n");
      const prompt = REPORT_PROMPT_TEMPLATE.replace("{{TRANSCRIPT}}", transcriptText);

      const genResult = await ai.models.generateContent({
        model: reportModel.modelId,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: reportModel.maxOutputTokens,
        },
      });

      let report: {
        summary_line: string;
        mood_score: number;
        emotion_tags: string[];
        parent_guide: string;
        emotion_level?: string;
        dashboard_cards?: Record<string, string>;
      };
      try {
        report = JSON.parse(genResult.text ?? "{}");
      } catch {
        throw new Error(`JSON 파싱 실패: ${genResult.text?.slice(0, 100)}`);
      }

      report.mood_score = Math.max(1, Math.min(10, Math.round(report.mood_score ?? 5)));

      const emotionLevel =
        report.emotion_level === "warning" || report.emotion_level === "danger"
          ? report.emotion_level
          : "safe";

      const DASHBOARD_KEYS = [
        "school_life",
        "peer_relations",
        "interests",
        "study_concerns",
        "digital_interests",
        "future_dreams",
        "recurring_stories",
      ] as const;
      const rawCards = report.dashboard_cards ?? {};
      const dashboardCards = Object.fromEntries(
        DASHBOARD_KEYS.map((k) => [k, typeof rawCards[k] === "string" ? rawCards[k] : ""]),
      );

      const { data: inserted, error: insertErr } = await db
        .from("daily_reports")
        .insert({
          session_id: session.id,
          summary_line: report.summary_line ?? "",
          mood_score: report.mood_score,
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
