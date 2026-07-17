// 리포트 생성 결과 후처리 가드 — 순수 TS, 외부 import 없음.
// reportModel.ts와 같은 이유로 순수하게 유지한다: Next.js(app/api/report/generate/route.ts,
// lib/batch/generateDailyReports.ts, lib/batch/generateWeeklySummary.ts)와 Supabase Edge
// Function(Deno, supabase/functions/_shared/batch.ts) 양쪽에서 provider(AI Studio/Vertex)와
// 무관하게 동일하게 적용해야 하므로, 여기에 외부(특히 Next 전용 경로) import를 추가하지 말 것.
//
// 프롬프트에도 진단/낙인 표현 금지 지시를 넣었지만(app/api/_lib/prompts.ts), LLM이 지시를
// 어길 가능성에 대비한 마지막 안전망으로 생성 결과 문자열을 한 번 더 치환한다.

// 매칭 순서가 중요하다 — 더 구체적인 표현을 먼저 검사해서 일반형 규칙에 선점되지 않게 한다.
const REPLACEMENTS: [RegExp, string][] = [
  [/자폐\s*스펙트럼/gi, "낯가림이 있는 모습"],
  [/자폐증?/gi, "낯가림이 있는 모습"],
  [/양극성\s*장애/gi, "감정 기복"],
  [/조울증/gi, "감정 기복"],
  [/우울증/gi, "속상한 마음"],
  [/불안\s*장애/gi, "불안한 마음"],
  [/공황\s*장애/gi, "긴장하는 모습"],
  [/강박증/gi, "반복하는 습관"],
  [/틱\s*장애/gi, "특정 행동을 반복하는 모습"],
  [/(ADHD|에이디에이치디|과잉\s*행동\s*장애?)/gi, "산만한 모습"],
  [/학습\s*장애/gi, "학습에 어려움을 느끼는 모습"],
  [/(정신\s*질환|정신병)/gi, "마음이 힘든 상태"],
  [/문제아/gi, "요즘 힘들어하는 아이"],
  [/비정상(적)?/gi, "평소와 다른"],
];

/** 문자열 하나에서 진단·낙인성 표현을 순화한다. */
export function sanitizeDiagnosticText(text: string): string {
  let result = text;
  for (const [pattern, replacement] of REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** JSON.parse된 리포트 객체 전체를 재귀적으로 순회하며 모든 문자열 값을 순화한다.
 *  emotion_level("safe"/"warning"/"danger") 같은 내부 enum 값은 위 패턴과 매칭되지 않으므로
 *  안전하게 그대로 통과한다. */
export function sanitizeReportJson<T>(value: T): T {
  if (typeof value === "string") {
    return sanitizeDiagnosticText(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeReportJson(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeReportJson(v);
    }
    return out as T;
  }
  return value;
}
