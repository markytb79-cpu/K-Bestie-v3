"use client";

import { useState } from "react";
import Link from "next/link";
import ChildTabBar from "@/components/ChildTabBar";
import { useStore } from "@/hooks/useStore";
import { toggleMission, setMoodScore } from "@/lib/store";

export default function ChildMissionsPage() {
  const store = useStore();
  const missions = store.missions;
  const completedCount = missions.filter((m) => m.completed).length;
  const totalCount = missions.length;

  const [expandedMoodId, setExpandedMoodId] = useState<number | null>(null);

  function handleMissionClick(id: number, isMoodRating?: boolean) {
    if (isMoodRating && !missions.find((m) => m.id === id)?.completed) {
      setExpandedMoodId((prev) => (prev === id ? null : id));
    } else {
      toggleMission(id);
    }
  }

  function handleStarPick(score: number) {
    setMoodScore(score);
    setExpandedMoodId(null);
  }

  return (
    <div
      className="min-h-dvh pb-[72px] w-full transition-all"
      style={{ background: "var(--color-child-bg)", fontFamily: "var(--font-child)" }}
    >
      {/* 헤더 */}
      <div className="px-5 pt-12 pb-4 max-w-5xl mx-auto">
        <Link href="/child/home" className="inline-block mb-3 text-xl transition-transform active:scale-90">←</Link>
        <h1 className="text-xl font-bold" style={{ color: "var(--color-primary)" }}>
          🎯 오늘의 미션
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
          {completedCount}/{totalCount}개 완료 · 화이팅! 🌟
        </p>

        {/* 진행 바 */}
        <div className="mt-3 h-2.5 rounded-full bg-gray-200 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%`,
              background: "linear-gradient(90deg, #1A6B5A 0%, #2a8a72 100%)",
            }}
          />
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-2">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
          
          {/* 왼쪽 열: 남은 미션 */}
          <div className="md:col-span-7 flex flex-col gap-4">
            {totalCount - completedCount > 0 ? (
              <div>
                <p className="text-xs font-bold mb-2.5 px-1" style={{ color: "var(--color-text-muted)" }}>
                  ⏳ 남은 미션 ({totalCount - completedCount}개)
                </p>
                <div className="flex flex-col gap-2.5">
                  {missions.filter((m) => !m.completed).map((mission) => (
                    <div key={mission.id}>
                      <button
                        onClick={() => handleMissionClick(mission.id, mission.isMoodRating)}
                        className="flex items-center gap-3 bg-white rounded-2xl px-4 py-4 w-full text-left active:opacity-80 transition-opacity"
                        style={{ boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}
                      >
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0"
                          style={{ background: "hsl(44 100% 92%)" }}
                        >
                          {mission.emoji}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800">{mission.title}</p>
                          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                            {mission.isMoodRating ? "별을 눌러 기분을 표현해봐 ⭐" : mission.desc}
                          </p>
                        </div>
                        <div
                          className="w-6 h-6 rounded-full shrink-0 transition-colors"
                          style={{ border: "2px solid #D1D5DB" }}
                        />
                      </button>

                      {/* 별점 인라인 피커 */}
                      {mission.isMoodRating && expandedMoodId === mission.id && (
                        <div
                          className="mx-1 mt-1 rounded-2xl p-4 flex flex-col items-center gap-3 bg-white"
                          style={{ border: "1.5px solid hsl(44 100% 85%)", boxShadow: "0 2px 12px rgba(26,107,90,0.10)" }}
                        >
                          <p className="text-sm font-bold" style={{ color: "var(--color-primary)" }}>
                            오늘 기분이 어때? 별로 알려줘!
                          </p>
                          <div className="flex gap-3">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <button
                                key={star}
                                onClick={() => handleStarPick(star)}
                                className="text-3xl transition-transform active:scale-125"
                              >
                                ⭐
                              </button>
                            ))}
                          </div>
                          <div className="flex justify-between w-full px-1">
                            {["😢", "😔", "😊", "😄", "🌟"].map((e, i) => (
                              <span key={i} className="text-lg">{e}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl p-6 text-center bg-white" style={{ boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}>
                <p className="text-3xl mb-2">🎉</p>
                <p className="text-sm font-bold text-gray-800">모든 미션을 완수했어요!</p>
                <p className="text-xs text-gray-400 mt-1">오늘도 정말 멋진 하루를 보냈구나!</p>
              </div>
            )}
          </div>

          {/* 오른쪽 열: 완료된 미션 및 대화 CTA */}
          <div className="md:col-span-5 flex flex-col gap-4">
            {/* 완료된 미션 목록 */}
            {completedCount > 0 && (
              <div>
                <p className="text-xs font-bold mb-2.5 px-1" style={{ color: "#22C55E" }}>
                  ✅ 완료 ({completedCount}개)
                </p>
                <div className="flex flex-col gap-2.5">
                  {missions.filter((m) => m.completed).map((mission) => (
                    <button
                      key={mission.id}
                      onClick={() => handleMissionClick(mission.id, mission.isMoodRating)}
                      className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3.5 w-full text-left active:opacity-80 transition-opacity"
                      style={{ boxShadow: "0 1px 6px rgba(0,0,0,0.06)", border: "1.5px solid #BBF7D0" }}
                    >
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0"
                        style={{ background: "#DCFCE7" }}
                      >
                        ✅
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold" style={{ color: "#9CA3AF", textDecoration: "line-through" }}>
                          {mission.title}
                        </p>
                        {mission.isMoodRating && store.moodScore !== null && (
                          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                            {"⭐".repeat(store.moodScore)} ({store.moodScore}점)
                          </p>
                        )}
                      </div>
                      <span className="text-xl shrink-0">🎉</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 케이와 대화 CTA */}
            <div className="mt-2">
              <Link
                href="/child/chat"
                className="block text-center py-4 rounded-2xl font-bold text-white text-sm active:opacity-90 shadow-sm"
                style={{ background: "var(--color-primary)" }}
              >
                🌿 케이와 대화하면서 미션 해결하기
              </Link>
            </div>
          </div>

        </div>
      </div>

      <ChildTabBar />
    </div>
  );
}
