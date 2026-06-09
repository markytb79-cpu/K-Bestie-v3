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
  const [inviteCode, setInviteCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
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

  const handleJoinFamily = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim() || inviteCode.length !== 6) {
      setJoinError("6자리 초대 코드를 입력해주세요.");
      return;
    }
    setJoining(true);
    setJoinError(null);
    try {
      const res = await fetch("/api/auth/join-child", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: inviteCode.trim().toUpperCase() }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "가족 연결에 실패했습니다.");
      }
      const data = await res.json();
      if (data.child_profile_id) {
        localStorage.setItem("k_child_id", data.child_profile_id);
        window.location.reload();
      } else {
        throw new Error("아이 프로필 ID를 찾을 수 없습니다.");
      }
    } catch (err: any) {
      setJoinError(err.message);
    } finally {
      setJoining(false);
    }
  };

  if (noChild) {
    return (
      <div
        className="min-h-dvh flex flex-col items-center justify-center px-6 py-8 text-center"
        style={{ background: "var(--color-child-bg)", fontFamily: "var(--font-child)" }}
      >
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-sm border border-emerald-500/10">
          <p className="text-5xl mb-4">🌱</p>
          <p className="text-lg font-bold text-gray-800">초대 코드를 입력해주세요</p>
          <p className="text-xs mt-2 leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
            부모님이 발급해주신 6자리 초대 코드를 입력하여<br />가족 그룹에 합류할 수 있습니다.
          </p>

          <form onSubmit={handleJoinFamily} className="mt-6 space-y-4">
            <input
              type="text"
              maxLength={6}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="코드를 입력하세요 (예: ABCDEF)"
              className="w-full text-center text-lg font-bold tracking-widest rounded-2xl px-4 py-3 border-2 border-transparent outline-none transition-colors"
              style={{ background: "#F9FAF6", border: "1px solid rgba(26,107,90,0.12)" }}
            />

            {joinError && (
              <p className="text-xs text-red-500 font-semibold mt-1">{joinError}</p>
            )}

            <button
              type="submit"
              disabled={joining}
              className="w-full py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform disabled:opacity-50"
              style={{ background: "var(--color-primary)" }}
            >
              {joining ? "연결하는 중..." : "가족 연결하기"}
            </button>
          </form>
        </div>
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

      {/* 활동 4종 그리드 */}
      <div className="max-w-5xl mx-auto px-4 py-4 mt-2">
        <h3 className="text-sm font-bold text-gray-700 mb-3 px-1">활동 선택하기</h3>
        <div className="grid grid-cols-2 gap-4">
          {/* 1. 오늘의 미션 */}
          <Link
            href="/child/missions"
            className="bg-white rounded-3xl p-5 flex flex-col justify-between h-[140px] shadow-sm border border-emerald-500/5 active:scale-[0.97] transition-all hover:shadow-md"
          >
            <div className="text-3xl">🎯</div>
            <div>
              <p className="text-sm font-bold text-gray-800">오늘의 미션</p>
              <p className="text-[11px] text-gray-400 mt-1">오늘 미션 진행하기</p>
            </div>
          </Link>

          {/* 2. 자유 대화 */}
          <Link
            href="/child/chat"
            className="bg-white rounded-3xl p-5 flex flex-col justify-between h-[140px] shadow-sm border border-emerald-500/5 active:scale-[0.97] transition-all hover:shadow-md"
          >
            <div className="text-3xl">💬</div>
            <div>
              <p className="text-sm font-bold text-gray-800">자유 대화</p>
              <p className="text-[11px] text-gray-400 mt-1">케이와 편하게 대화하기</p>
            </div>
          </Link>

          {/* 3. 책읽기 */}
          <button
            onClick={() => alert("준비 중인 서비스입니다. 조금만 기다려주세요! 📚")}
            className="bg-white rounded-3xl p-5 flex flex-col justify-between h-[140px] shadow-sm border border-gray-100 opacity-65 text-left active:scale-[0.97] transition-all"
          >
            <div className="flex justify-between items-start">
              <span className="text-3xl">📚</span>
              <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">준비중</span>
            </div>
            <div>
              <p className="text-sm font-bold text-gray-400">책읽기</p>
              <p className="text-[11px] text-gray-300 mt-1">케이가 들려주는 책방</p>
            </div>
          </button>

          {/* 4. 퀴즈 */}
          <button
            onClick={() => alert("준비 중인 서비스입니다. 조금만 기다려주세요! 🧩")}
            className="bg-white rounded-3xl p-5 flex flex-col justify-between h-[140px] shadow-sm border border-gray-100 opacity-65 text-left active:scale-[0.97] transition-all"
          >
            <div className="flex justify-between items-start">
              <span className="text-3xl">🧩</span>
              <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">준비중</span>
            </div>
            <div>
              <p className="text-sm font-bold text-gray-400">퀴즈 풀기</p>
              <p className="text-[11px] text-gray-300 mt-1">재미있는 상식 퀴즈</p>
            </div>
          </button>
        </div>
      </div>

      <DemoSwitcher mode="child" />
      <ChildTabBar />
    </div>
  );
}
