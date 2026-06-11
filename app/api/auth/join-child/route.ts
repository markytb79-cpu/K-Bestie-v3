import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/*
 * [DEACTIVATED - 베타 전환: 초대 코드 방식 제거]
 *
 * 이 엔드포인트는 child_invite_codes 기반 6자리 코드 입력 방식을 처리했으나,
 * 소셜 로그인(구글) 전용 베타 전환으로 비활성화됨.
 *
 * 대체 흐름:
 *   아이가 구글 로그인 → POST /api/auth/auto-join 호출
 *   → child_profiles.email 매칭으로 자동 가족 합류
 *
 * 복원이 필요할 경우 git log에서 이전 구현 참조.
 */
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      error:
        "초대 코드 방식은 베타에서 사용되지 않습니다. 구글 로그인 후 자동으로 가족에 연결됩니다.",
      deprecated: true,
    },
    { status: 410 }
  );
}
