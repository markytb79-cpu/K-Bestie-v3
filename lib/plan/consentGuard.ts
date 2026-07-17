// 법정대리인 동의 철회(child_profiles.guardian_consent_withdrawn_at) 가드 — 서버 전용.
// 철회된 아이 계정은 채팅/미션/음성/리포트 생성 API를 전부 차단한다.
// (열람 자체는 RLS가 별도로 처리하는 영역이라 이 파일의 범위 밖 — 여기는 "새 소비/생성"만 막는다.)

import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const CONSENT_WITHDRAWN_MESSAGE = "보호자가 이 계정의 개인정보 수집·이용 동의를 철회했습니다";

async function isConsentWithdrawn(childId: string): Promise<boolean> {
  const service = createServiceClient();
  const { data } = await service
    .from("child_profiles")
    .select("guardian_consent_withdrawn_at")
    .eq("id", childId)
    .maybeSingle();
  return !!(data as { guardian_consent_withdrawn_at?: string | null } | null)?.guardian_consent_withdrawn_at;
}

/** childId를 이미 알고 있는 라우트용. 철회됐으면 403 응답, 아니면 null(통과). */
export async function checkConsentForChild(childId: string): Promise<NextResponse | null> {
  if (await isConsentWithdrawn(childId)) {
    return NextResponse.json({ error: CONSENT_WITHDRAWN_MESSAGE }, { status: 403 });
  }
  return null;
}

/** sessionId만 아는 라우트용 — chat_sessions.child_id를 조회해 동일하게 검사한다.
 *  세션을 못 찾으면 null을 반환하므로(가드 통과), 호출부의 기존 세션 조회/404 처리에 맡긴다. */
export async function checkConsentForSession(sessionId: string): Promise<NextResponse | null> {
  const service = createServiceClient();
  const { data: session } = await service
    .from("chat_sessions")
    .select("child_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session?.child_id) return null;
  return checkConsentForChild(session.child_id);
}
