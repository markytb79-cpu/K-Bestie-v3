"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ChildTabBar from "@/components/ChildTabBar";
import DemoSwitcher from "@/components/DemoSwitcher";
import { useStore } from "@/hooks/useStore";

type ChildInfo = { id: string; name: string; grade: string };

export default function ChildHomePage() {
  const [child, setChild] = useState<ChildInfo | null>(null);
  const [noChild, setNoChild] = useState(false);
  const store = useStore();
  const missions = store.missions;
  const completedCount = missions.filter((m) => m.completed).length;
  const totalCount = missions.length;

  useEffect(() => {
    const id = localStorage.getItem("k_child_id");
    if (!id) {
      setNoChild(true);
      return;
    }
    fetch(`/api/child/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setChild(data); else setNoChild(true); })
      .catch(() => {});
  }, []);

  if (noChild) {
    return (
      <div
        className="min-h-dvh flex flex-col items-center justify-center px-6 text-center"
        style={{ background: "var(--color-child-bg)", fontFamily: "var(--font-child)" }}
      >
        <p className="text-5xl mb-4">🌱</p>
        <p className="text-base font-bold text-gray-700">아직 아이가 등록되지 않았어요</p>
        <p className="text-sm mt-2 leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
          부모님이 먼저 아이를 추가해주세요
        </p>
        <DemoSwitcher mode="child" />
        <ChildTabBar />
      </div>
    );
  }

  return (
    <div
      className="min-h-dvh pb-[72px] w-full transition-all"
      style={{ background: "var(--color-child-bg)", fontFamily: "var(--font-child)" }}
    >
      {/* 헤더 */}
      <div className="px-5 pt-12 pb-2 text-center">
        <p className="text-3xl mb-2">🌱</p>
        <h1 className="text-xl font-bold" style={{ color: "var(--color-primary)" }}>
          {child ? `안녕 ${child.name}! 나 케이야 👋` : "안녕! 나 케이야 👋"}
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
          오늘 하루 어땠어? 같이 얘기해 보자!
        </p>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
          
          {/* 왼쪽 열: 케이 캐릭터 카드 */}
          <div className="md:col-span-5 flex flex-col gap-4">
            <div
              className="rounded-3xl p-5 flex items-center gap-4 bg-white"
              style={{ boxShadow: "0 2px 16px rgba(26,107,90,0.10)" }}
            >
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-4xl shrink-0"
                style={{ background: "hsl(44 100% 92%)" }}
              >
                🌿
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-gray-800">케이</p>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                  오늘도 네 이야기가 궁금해!
                  <br />
                  미션도 같이 해보자 🎯
                </p>
                <Link
                  href="/child/chat"
                  className="mt-2.5 inline-block px-4 py-1.5 rounded-full text-xs font-bold text-white transition-transform active:scale-95"
                  style={{ background: "var(--color-primary)" }}
                >
                  대화하기 💬
                </Link>
              </div>
            </div>
          </div>

          {/* 오른쪽 열: 미션 진행 현황 */}
          <div className="md:col-span-7 flex flex-col gap-4">
            <div className="bg-white rounded-3xl p-5" style={{ boxShadow: "0 2px 16px rgba(26,107,90,0.05)" }}>
              <div className="flex items-center justify-between mb-2.5">
                <h2 className="text-[15px] font-bold" style={{ color: "var(--color-primary)" }}>
                  오늘의 미션
                </h2>
                <span className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>
                  {completedCount}/{totalCount} 완료
                </span>
              </div>

              {/* 진행 바 */}
              <div className="h-2 rounded-full bg-gray-200 mb-4 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%`,
                    background: "linear-gradient(90deg, #1A6B5A 0%, #2a8a72 100%)",
                  }}
                />
              </div>

              {/* 미션 카드 (처음 3개) */}
              <div className="flex flex-col gap-2.5">
                {missions.slice(0, 3).map((mission) => (
                  <div
                    key={mission.id}
                    className="flex items-center gap-3 bg-gray-50 rounded-2xl px-4 py-3.5"
                    style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0"
                      style={{ background: mission.completed ? "#DCFCE7" : "hsl(44 100% 92%)" }}
                    >
                      {mission.completed ? "✅" : mission.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-semibold truncate"
                        style={{
                          color: mission.completed ? "#9CA3AF" : "var(--color-text-base)",
                          textDecoration: mission.completed ? "line-through" : "none",
                        }}
                      >
                        {mission.title}
                      </p>
                      <p className="text-xs truncate" style={{ color: "var(--color-text-muted)" }}>
                        {mission.desc}
                      </p>
                    </div>
                    {mission.completed && <span className="text-lg shrink-0">🎉</span>}
                  </div>
                ))}
              </div>

              {/* 미션 전체 보기 */}
              <Link
                href="/child/missions"
                className="mt-4 block text-center py-3 rounded-2xl text-sm font-semibold border transition-opacity active:opacity-70"
                style={{
                  borderColor: "rgba(26,107,90,0.25)",
                  color: "var(--color-primary)",
                  background: "rgba(26,107,90,0.04)",
                }}
              >
                미션 전체 보기 →
              </Link>
            </div>
          </div>

        </div>
      </div>

      <DemoSwitcher mode="child" />
      <ChildTabBar />
    </div>
  );
}
