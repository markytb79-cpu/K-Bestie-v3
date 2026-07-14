import { createServiceClient } from "@/lib/supabase/server";

/** childId의 현재 tier를 서버가 직접 조회(클라이언트 입력 신뢰 안 함). 조회 실패 시 1(Care Start)로 안전하게 취급. */
export async function getTierForChild(childId: string): Promise<number> {
  const service = createServiceClient();
  const { data } = await service
    .from("child_profiles")
    .select("tier")
    .eq("id", childId)
    .maybeSingle();
  return (data as { tier?: number } | null)?.tier ?? 1;
}

/** Care Start(tier 1)에게는 상세 전용 필드 접근을 허용하지 않는다. */
export function isDetailAllowed(tier: number): boolean {
  return tier >= 2;
}
