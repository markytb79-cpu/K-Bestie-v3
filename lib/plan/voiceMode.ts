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
