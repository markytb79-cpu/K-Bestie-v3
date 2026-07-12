"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealChildNav } from "@/components/RealChildNav";
import { LIVE_VOICE_OPTIONS } from "@/lib/plan/liveVoices";

export default function ChildSettingsPage() {
  const router = useRouter();
  const [childId, setChildId] = useState<string | null>(null);
  const [tier, setTier] = useState<number | null>(null);
  const [liveVoiceName, setLiveVoiceName] = useState<string>("Achernar");
  const [savingVoice, setSavingVoice] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/child/me");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setChildId(data.id ?? null);
        setTier(typeof data.tier === "number" ? data.tier : null);
        if (typeof data.live_voice_name === "string" && data.live_voice_name) {
          setLiveVoiceName(data.live_voice_name);
        }
      } catch {
        // 조회 실패 시 목소리 설정 UI는 노출하지 않음(tier가 null로 남아 자동으로 숨겨짐)
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleVoiceChange = async (name: string) => {
    setLiveVoiceName(name);
    if (!childId) return;
    setSavingVoice(true);
    try {
      await fetch(`/api/child/${childId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liveVoiceName: name }),
      });
    } catch {
      // 저장 실패해도 화면 선택은 유지 — 다음 미션 시작 시 서버 저장값 기준으로 다시 맞춰짐
    } finally {
      setSavingVoice(false);
    }
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut().catch(() => {});
    localStorage.removeItem("k_child_id");
    localStorage.removeItem("k_session_id");
    router.push("/login");
  };

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
        <div
          className="shrink-0 flex items-center justify-center px-4 py-4"
          style={{ background: "#fafaf8" }}
        >
          <Link href="/child/home" className="font-bold text-sm cursor-pointer" style={{ color: "#1a6b5a" }}>
            설정
          </Link>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          {tier === 3 && (
            <div className="bg-white rounded-2xl px-4 py-4 shadow-sm flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0"
                  style={{ background: "#f3f4f6" }}
                >
                  🔊
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold" style={{ color: "#1e1e2d" }}>
                    케이 목소리
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: "#6b7280" }}>
                    미션에서 케이가 말할 목소리를 골라보세요
                  </p>
                </div>
              </div>

              {(["female", "male"] as const).map((gender) => (
                <div key={gender} className="flex flex-col gap-1.5">
                  <p className="text-[11px] font-bold" style={{ color: "#9ca3af" }}>
                    {gender === "female" ? "여자" : "남자"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {LIVE_VOICE_OPTIONS.filter((v) => v.gender === gender).map((v) => (
                      <button
                        key={v.name}
                        onClick={() => handleVoiceChange(v.name)}
                        disabled={savingVoice}
                        className="px-3 py-2 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50 transition-colors"
                        style={
                          liveVoiceName === v.name
                            ? { background: "#1a6b5a", color: "#ffffff" }
                            : { background: "#f3f4f6", color: "#1e1e2d" }
                        }
                      >
                        {v.name} ({v.label})
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={handleLogout}
            className="bg-white rounded-2xl px-4 py-4 shadow-sm flex items-center gap-3 cursor-pointer active:opacity-85 transition-opacity w-full text-left"
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0"
              style={{ background: "#f3f4f6" }}
            >
              🚪
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold" style={{ color: "#1e1e2d" }}>
                로그아웃
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "#6b7280" }}>
                다음에 또 만나요
              </p>
            </div>
            <span className="text-sm" style={{ color: "#6b7280" }}>
              →
            </span>
          </button>
        </div>

        <RealChildNav active="설정" />
      </div>
    </DemoFrame>
  );
}
