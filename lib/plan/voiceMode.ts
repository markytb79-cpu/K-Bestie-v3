// 요금제(tier)별 음성 방식 분기 유틸 — 서버 전용(createServiceClient 사용, RLS 우회)
// tier는 아이 단위(child_profiles.tier)로 관리된다 — 형제자매가 서로 다른 tier를 가질 수 있다.

import { createServiceClient } from "@/lib/supabase/server";
import { DEFAULT_LIVE_VOICE_NAME } from "@/lib/plan/liveVoices";

export type VoiceMode = "stt_tts" | "live";

const DEFAULT_TIER = 1;
const DEFAULT_VOICE_MODE: VoiceMode = "stt_tts";

/** 아이(child_profiles.id) 본인의 tier를 조회해 voice_mode(+ Tier3 전용 live_voice_name)를 반환.
 *  조회 실패 시 Tier1(stt_tts)/기본 목소리로 안전하게 폴백. */
export async function getVoiceModeForChild(
  childId: string
): Promise<{ tier: number; voiceMode: VoiceMode; liveVoiceName: string }> {
  try {
    const service = createServiceClient();

    const { data: child } = await service
      .from("child_profiles")
      .select("tier, live_voice_name")
      .eq("id", childId)
      .maybeSingle();
    const tier = (child as { tier?: number } | null)?.tier ?? DEFAULT_TIER;
    const liveVoiceName =
      (child as { live_voice_name?: string } | null)?.live_voice_name ?? DEFAULT_LIVE_VOICE_NAME;

    const { data: plan } = await service
      .from("plans")
      .select("voice_mode")
      .eq("tier", tier)
      .maybeSingle();
    const voiceMode = ((plan as { voice_mode?: VoiceMode } | null)?.voice_mode) ?? DEFAULT_VOICE_MODE;

    return { tier, voiceMode, liveVoiceName };
  } catch {
    // plans/child_profiles.tier·live_voice_name 조회 실패 등 — 안전하게 기본값
    return { tier: DEFAULT_TIER, voiceMode: DEFAULT_VOICE_MODE, liveVoiceName: DEFAULT_LIVE_VOICE_NAME };
  }
}

export interface UsageContext {
  childId: string;
  tier: number;
  voiceMode: VoiceMode;
}

/** usage_events 계측용 — sessionId만으로 child_id/tier/voice_mode를 서버가 직접 해석한다(server-trust).
 *  sessionId가 없거나 세션을 찾지 못하면 null(로깅만 생략, 응답 자체는 막지 않음). */
export async function resolveUsageContext(sessionId: string | null | undefined): Promise<UsageContext | null> {
  if (!sessionId) return null;

  const service = createServiceClient();
  const { data: session } = await service
    .from("chat_sessions")
    .select("child_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session?.child_id) return null;

  const { tier, voiceMode } = await getVoiceModeForChild(session.child_id);
  return { childId: session.child_id, tier, voiceMode };
}
