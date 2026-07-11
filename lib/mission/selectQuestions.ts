// 미션 출제 선택 알고리즘 (서버 전용 — createServiceClient 사용, RLS 우회)
//
// 입력: childId, grade(정수), roundType
// 출력: 선택된 질문 id 8개 순서 배열 (앞 5개 = 필수, 뒤 3개 = 예비)
//
// 선택 로직:
//   1. 학년 + 이번 회차(round1/round2/common)에 맞는 활성 질문 후보 필터링
//   2. 이미 물어본 온보딩(1회성) 질문 제외
//   3. 주기가 아직 안 돌아온 질문(weekly/monthly/quarterly, 마지막 출제일 기준) 제외
//   4. 상시(always) 기분체크 질문 1~2개 필수 포함
//   5. 나머지를 채워 필수5 + 예비3 = 8개 구성
//   6. 온보딩("친해지기") 질문은 우선 배치해 첫 1주간 매 미션마다 자연스럽게 소진

import { createServiceClient } from "@/lib/supabase/server";

export type RoundType = "round1_day" | "round2_night" | "common";
export type CycleType = "onboarding" | "always" | "weekly" | "monthly" | "quarterly";

interface QuestionRow {
  id: string;
  cycle_type: CycleType;
  dashboard_area_tag: string;
  round_type: RoundType;
  applicable_grades: number[];
}

const REQUIRED_COUNT = 5;
const RESERVE_COUNT = 3;
const TOTAL_COUNT = REQUIRED_COUNT + RESERVE_COUNT; // 8

const MIN_MOOD_CHECK = 1; // 상시 기분체크 최소 포함 개수
const MAX_MOOD_CHECK = 2;

/** 주기별 재출제 최소 간격(일). onboarding/always 는 여기서 제외(별도 처리) */
const CYCLE_INTERVAL_DAYS: Record<Exclude<CycleType, "onboarding" | "always">, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 90,
};

/** "초4", "4학년", "4" 등 학년 텍스트를 정수로 파싱 (실패 시 null) */
export function parseGrade(grade: string | number | null | undefined): number | null {
  if (typeof grade === "number") return Number.isFinite(grade) ? grade : null;
  if (!grade) return null;
  const m = String(grade).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 미션 질문 8개(필수5+예비3)를 선별해 순서 배열로 반환한다.
 * @returns 질문 id 배열 (최대 8개, 후보 부족 시 그보다 적을 수 있음)
 */
export async function selectQuestions(
  childId: string,
  grade: number,
  roundType: RoundType
): Promise<string[]> {
  const service = createServiceClient();

  // 1. 학년 + 회차 후보 (활성 질문). round_type 은 해당 회차 또는 common 포함
  const { data: candidatesRaw, error: qErr } = await service
    .from("mission_questions")
    .select("id, cycle_type, dashboard_area_tag, round_type, applicable_grades")
    .eq("is_active", true)
    .in("round_type", [roundType, "common"]);

  if (qErr || !candidatesRaw) return [];

  const candidates = (candidatesRaw as QuestionRow[]).filter((q) =>
    Array.isArray(q.applicable_grades) && q.applicable_grades.includes(grade)
  );
  if (candidates.length === 0) return [];

  // 아이의 출제이력 로드 (question_id -> 마지막 asked_at)
  const { data: historyRaw } = await service
    .from("mission_question_history")
    .select("question_id, asked_at")
    .eq("child_id", childId);

  const lastAskedAt = new Map<string, number>();
  for (const h of (historyRaw ?? []) as { question_id: string; asked_at: string }[]) {
    const t = new Date(h.asked_at).getTime();
    const prev = lastAskedAt.get(h.question_id);
    if (prev === undefined || t > prev) lastAskedAt.set(h.question_id, t);
  }

  const now = Date.now();
  const daysSince = (ts: number) => (now - ts) / (1000 * 60 * 60 * 24);

  // 2/3. 주기 필터
  const eligible = candidates.filter((q) => {
    const last = lastAskedAt.get(q.id);
    if (q.cycle_type === "onboarding") {
      return last === undefined; // 이미 물어본 온보딩 제외
    }
    if (q.cycle_type === "always") {
      return true; // 상시는 항상 후보
    }
    if (last === undefined) return true; // 주기형이지만 한 번도 출제 안 됨
    return daysSince(last) >= CYCLE_INTERVAL_DAYS[q.cycle_type];
  });

  const picked: string[] = [];
  const pickedSet = new Set<string>();
  const add = (ids: string[]) => {
    for (const id of ids) {
      if (picked.length >= TOTAL_COUNT) break;
      if (!pickedSet.has(id)) {
        picked.push(id);
        pickedSet.add(id);
      }
    }
  };

  const moodChecks = shuffle(eligible.filter((q) => q.cycle_type === "always" && q.dashboard_area_tag === "emotion"));
  const onboarding = shuffle(eligible.filter((q) => q.cycle_type === "onboarding"));
  const rest = shuffle(
    eligible.filter(
      (q) => !(q.cycle_type === "always" && q.dashboard_area_tag === "emotion") && q.cycle_type !== "onboarding"
    )
  );

  // 4. 상시 기분체크 1~2개 필수 포함
  add(moodChecks.slice(0, MAX_MOOD_CHECK).map((q) => q.id));

  // 6. 온보딩 우선 소진 (기분체크 확보 후)
  add(onboarding.map((q) => q.id));

  // 5. 나머지로 채우기
  add(rest.map((q) => q.id));

  // [보정] 만약 주기 필터로 인해 picked 질문 개수가 5개(REQUIRED_COUNT) 미만인 경우,
  // 학년 조건에 해당하는 전체 후보(candidates) 중에서 아직 픽업되지 않은 질문들을
  // 가장 과거에 출제되었던 순(asked_at이 없거나 오래된 순)으로 정렬하여 5개를 충족할 때까지 강제로 채웁니다.
  if (picked.length < REQUIRED_COUNT) {
    const remainingCandidates = candidates.filter((q) => !pickedSet.has(q.id));
    const sortedRemaining = remainingCandidates.sort((a, b) => {
      const aTime = lastAskedAt.get(a.id) ?? 0;
      const bTime = lastAskedAt.get(b.id) ?? 0;
      return aTime - bTime;
    });
    add(sortedRemaining.map((q) => q.id));
  }

  // 기분체크가 하나도 없고 후보에 남아있다면(이미 add로 처리됐지만) 보정
  if (moodChecks.length >= MIN_MOOD_CHECK) {
    const hasMood = picked.some((id) => moodChecks.some((m) => m.id === id));
    if (!hasMood && picked.length > 0) {
      picked[picked.length - 1] = moodChecks[0].id;
    }
  }

  return picked.slice(0, TOTAL_COUNT);
}
