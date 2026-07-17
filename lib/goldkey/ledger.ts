import { createServiceClient } from "@/lib/supabase/server";

// 황금열쇠 원장 (gold_key_ledger) 서버 전용 로직
// 적립: 출석 1개/일 + 미션완료 최대 2개/일, 만료 = earned_at + 7일
// 차감: FIFO(만료 임박 = expires_at 오름차순)
// 하루 경계는 Asia/Seoul 자정 기준
// V2 질문엔진 미션완료 보상은 record_v2_mission_answer SQL RPC가 직접 처리한다 — 이 함수는 V1 경로 및 출석/기타 용도로만 계속 쓰인다

const KST_OFFSET = "+09:00";
const EXPIRE_DAYS = 7;
const MISSION_DAILY_LIMIT = 2;

// 확정 정책(대표님 승인, 2026-07-18): 활성 골드키 보유 상한 22개.
// V2 미션완료 보상은 SQL RPC(record_v2_mission_answer, supabase/migrations/20260717170000_question_engine_v2_atomic_rpc.sql)가
// 직접 처리하므로 이 상수는 이 TS 파일에서 직접 실행되지는 않지만, 정책의 단일 문서화 지점(source of documentation)이다.
// [동기화 기준] 이 파일의 EXPIRE_DAYS/MISSION_DAILY_LIMIT/MAX_ACTIVE_BALANCE 중 하나라도 변경되면
// 반드시 위 SQL RPC 파일의 대응 하드코딩 값(만료일수, 일일한도, 잔액상한)도 같은 커밋에서 함께 갱신할 것 — 두 값이
// 어긋나면 V1(TS 경로)과 V2(RPC 경로)의 보상 정책이 서로 달라지는 회귀가 발생한다.
const MAX_ACTIVE_BALANCE = 22;

/** Asia/Seoul 기준 오늘 날짜 "YYYY-MM-DD" */
function kstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** KST 오늘 하루의 [시작, 끝) ISO 경계 (earned_at 필터용) */
function kstDayRange(): { start: string; end: string } {
  const day = kstToday();
  return {
    start: `${day}T00:00:00.000${KST_OFFSET}`,
    end: `${day}T23:59:59.999${KST_OFFSET}`,
  };
}

function expiresAtFromNow(): string {
  return new Date(Date.now() + EXPIRE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

async function countEarnedToday(childId: string, reason: "attendance" | "mission"): Promise<number> {
  const supabase = createServiceClient();
  const { start, end } = kstDayRange();
  const { count, error } = await supabase
    .from("gold_key_ledger")
    .select("id", { count: "exact", head: true })
    .eq("child_id", childId)
    .eq("reason", reason)
    .gte("earned_at", start)
    .lte("earned_at", end);

  if (error) throw error;
  return count ?? 0;
}

export type EarnResult = { earned: boolean; reason?: string };

/** 출석 적립 — 오늘 이미 출석 적립했으면 스킵(중복 방지) */
export async function earnAttendanceKey(childId: string): Promise<EarnResult> {
  const already = await countEarnedToday(childId, "attendance");
  if (already > 0) return { earned: false, reason: "already_earned_today" };

  const supabase = createServiceClient();
  const { error } = await supabase.from("gold_key_ledger").insert({
    child_id: childId,
    reason: "attendance",
    expires_at: expiresAtFromNow(),
  });
  if (error) throw error;
  return { earned: true };
}

/** 미션완료 적립 — 오늘 미션완료로 이미 2개 적립했으면 스킵 */
export async function earnMissionCompleteKey(
  childId: string,
  missionId?: string,
  rewardType: string = "mission_complete"
): Promise<EarnResult> {
  const already = await countEarnedToday(childId, "mission");
  if (already >= MISSION_DAILY_LIMIT) return { earned: false, reason: "daily_limit_reached" };

  const supabase = createServiceClient();
  const insertPayload: any = {
    child_id: childId,
    reason: "mission",
    expires_at: expiresAtFromNow(),
  };

  if (missionId) {
    insertPayload.mission_id = missionId;
    insertPayload.reward_type = rewardType;
  }

  const { error } = await supabase.from("gold_key_ledger").insert(insertPayload);
  
  if (error) {
    if (error.code === "23505") {
      return { earned: false, reason: "already_earned" };
    }
    throw error;
  }
  return { earned: true };
}

/** 유효(미만료·미소비) 황금열쇠 개수 */
export async function getBalance(childId: string): Promise<number> {
  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from("gold_key_ledger")
    .select("id", { count: "exact", head: true })
    .eq("child_id", childId)
    .eq("consumed", false)
    .gt("expires_at", new Date().toISOString());

  if (error) throw error;
  return count ?? 0;
}

export type ConsumeResult =
  | { ok: true; consumed: number; balance: number }
  | { ok: false; reason: "insufficient" | "invalid_count"; balance: number };

/**
 * FIFO(만료 임박 우선)로 count개 소비.
 * 잔액 부족이면 아무것도 소비하지 않고 실패 반환.
 * 동시성: consumed=false 조건부 update로 이미 소비된 행 재사용 방지.
 */
export async function consumeKeys(childId: string, count: number): Promise<ConsumeResult> {
  if (!Number.isInteger(count) || count <= 0) {
    return { ok: false, reason: "invalid_count", balance: await getBalance(childId) };
  }

  const supabase = createServiceClient();
  const nowIso = new Date().toISOString();

  // 만료 임박순으로 후보 행 선점 (필요 개수만)
  const { data: rows, error: fetchErr } = await supabase
    .from("gold_key_ledger")
    .select("id")
    .eq("child_id", childId)
    .eq("consumed", false)
    .gt("expires_at", nowIso)
    .order("expires_at", { ascending: true })
    .limit(count);

  if (fetchErr) throw fetchErr;
  if (!rows || rows.length < count) {
    return { ok: false, reason: "insufficient", balance: await getBalance(childId) };
  }

  const ids = rows.map((r) => r.id);
  // consumed=false 조건부 update — 경합 시 이미 소비된 행은 갱신되지 않음
  const { data: updated, error: updErr } = await supabase
    .from("gold_key_ledger")
    .update({ consumed: true, consumed_at: nowIso })
    .in("id", ids)
    .eq("consumed", false)
    .select("id");

  if (updErr) throw updErr;

  const consumed = updated?.length ?? 0;
  if (consumed < count) {
    // 경합으로 일부만 소비됨 — 소비한 만큼은 유지(원장 특성상 롤백 불가), 부족분 알림
    return { ok: false, reason: "insufficient", balance: await getBalance(childId) };
  }

  return { ok: true, consumed, balance: await getBalance(childId) };
}
