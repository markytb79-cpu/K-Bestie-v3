import { NextResponse } from "next/server";

export const runtime = "nodejs";

// 아이 화면 진입 시간 제한(운영시간 게이트, app/child/missions/page.tsx) on/off 스위치 —
// 서버 환경변수 CHILD_TIME_RESTRICTIONS_ENABLED 전용(값 없으면 기본 true=기존 제한 정상 적용).
// false로 설정하면 그 게이트만 건너뛴다 — 게이트 로직(getKstHour/currentRound) 자체는 그대로
// 유지되고, 다시 true로 되돌리면(또는 값을 지우면) 즉시 복원된다.
//
// 하루 이용 횟수·누적 이용시간·휴식시간·미션 만료시간 판정 로직은 이 코드베이스에 아직
// 구현돼 있지 않다(FUTURE_TODO.md #2 — Tier3 하루 사용시간 상한 미구현, DB 테이블도 없음).
// 이 스위치가 끄고 켜는 대상은 오직 운영시간 게이트 하나뿐이다.
export async function GET() {
  const enabled = process.env.CHILD_TIME_RESTRICTIONS_ENABLED !== "false";
  return NextResponse.json({ enabled });
}
