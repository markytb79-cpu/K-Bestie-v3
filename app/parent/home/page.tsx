"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import ParentTabBar from "@/components/ParentTabBar";
import { ChevronRight } from "@/components/ParentIcons";
import DemoSwitcher from "@/components/DemoSwitcher";
import { useStore } from "@/hooks/useStore";

function BellSvg() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

interface Report {
  id: string;
  summary_line: string;
  mood_score: number;
  emotion_tags: string[];
  session: { turn_count: number } | null;
}

export default function ParentHomePage() {
  const store = useStore();
  const children = store.children;
  const unreadCount = store.notifications.filter((n) => !n.read).length;

  const [activeIdx, setActiveIdx] = useState(0);
  const [latestReport, setLatestReport] = useState<Report | null>(null);
  const [reportCount, setReportCount] = useState(0);
  const [reportLoading, setReportLoading] = useState(false);

  const activeChild = children[activeIdx] ?? null;

  // activeIdx 범위 보정 (아이 삭제 후)
  useEffect(() => {
    if (children.length > 0 && activeIdx >= children.length) {
      setActiveIdx(children.length - 1);
    }
  }, [children.length, activeIdx]);

  useEffect(() => {
    if (!activeChild || activeChild.id.startsWith("demo-")) {
      setLatestReport(null);
      setReportCount(0);
      setReportLoading(false);
      return;
    }

    setLatestReport(null);
    setReportCount(0);
    setReportLoading(true);

    fetch(`/api/parent/reports?childId=${encodeURIComponent(activeChild.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const reports: Report[] = data?.reports ?? [];
        if (reports.length > 0) {
          setLatestReport(reports[0]);
          setReportCount(reports.length);
        }
      })
      .catch(() => {})
      .finally(() => setReportLoading(false));
  }, [activeChild?.id]);

  const header = (
    <div className="bg-white px-5 pt-12 pb-4 flex items-center justify-between">
      <div>
        <p className="text-xs font-medium" style={{ color: "var(--hb-muted)" }}>내친구 케이</p>
        <h1 className="text-[17px] font-bold text-gray-900 mt-0.5">안녕하세요, 보호자님 👋</h1>
      </div>
      <Link href="/parent/notifications" className="relative p-2 -mr-1">
        <BellSvg />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {Math.min(unreadCount, 9)}
          </span>
        )}
      </Link>
    </div>
  );

  // 아이 없음 → 빈 상태
  if (children.length === 0) {
    return (
      <div className="min-h-dvh pb-[72px] lg:pb-10 lg:pl-[240px] w-full" style={{ background: "var(--hb-bg)" }}>
        {header}
        <div className="max-w-3xl mx-auto px-4 py-14 flex flex-col items-center text-center gap-4">
          <p className="text-5xl">👶</p>
          <div>
            <p className="text-base font-bold text-gray-800">아직 등록된 아이가 없어요</p>
            <p className="text-sm mt-1.5 leading-relaxed" style={{ color: "var(--hb-muted)" }}>
              아이를 추가해 케이와 대화를 시작해보세요
            </p>
          </div>
          <Link
            href="/onboarding"
            className="mt-2 px-6 py-3 rounded-full text-sm font-bold text-white shadow-sm active:scale-95 transition-transform"
            style={{ background: "var(--hb-primary)" }}
          >
            아이 추가하기
          </Link>
        </div>
        <DemoSwitcher mode="parent" />
        <ParentTabBar />
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-[72px] lg:pb-12 lg:pl-[240px] w-full transition-all" style={{ background: "var(--hb-bg)" }}>
      {header}

      <div className="max-w-6xl mx-auto px-4 py-4">
        {/* 프로필 스위처 */}
        <div className="flex items-center gap-4 px-1 mb-6 overflow-x-auto py-1">
          {children.map((child, idx) => (
            <button
              key={child.id}
              onClick={() => setActiveIdx(idx)}
              className="flex flex-col items-center gap-1.5 shrink-0 group"
            >
              <div
                className="w-[56px] h-[56px] rounded-full flex items-center justify-center text-2xl transition-all group-active:scale-95"
                style={{
                  border: activeIdx === idx ? "2.5px solid #5B5BD6" : "2px solid #E5E7EB",
                  background: activeIdx === idx ? "#EDEDFC" : "#F9FAFB",
                  boxShadow: activeIdx === idx ? "0 4px 12px rgba(91,91,214,0.15)" : "none",
                }}
              >
                🧒
              </div>
              <span
                className="text-xs font-semibold"
                style={{ color: activeIdx === idx ? "#5B5BD6" : "#9CA3AF" }}
              >
                {child.name}
              </span>
            </button>
          ))}

          <Link href="/onboarding" className="flex flex-col items-center gap-1.5 shrink-0">
            <div
              className="w-[56px] h-[56px] rounded-full flex items-center justify-center text-xl active:scale-95 transition-transform"
              style={{ border: "2px dashed #D1D5DB", background: "#F9FAFB", color: "#9CA3AF" }}
            >
              +
            </div>
            <span className="text-xs" style={{ color: "#9CA3AF" }}>추가</span>
          </Link>
        </div>

        {/* 메인 반응형 그리드 시스템 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-5">
          
          {/* 왼쪽 또는 메인 열: 오늘의 기록 카드 */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "var(--hb-shadow)" }}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-xs font-semibold mb-0.5" style={{ color: "var(--hb-muted)" }}>오늘의 기록</p>
                  <h2 className="text-[17px] font-bold text-gray-900">
                    {activeChild!.name}이의 오늘
                  </h2>
                </div>
                {latestReport ? (
                  <div className="flex items-baseline gap-0.5 px-3.5 py-1.5 rounded-full" style={{ background: "#DCFCE7" }}>
                    <span className="text-sm font-bold" style={{ color: "#15803D" }}>{latestReport.mood_score}</span>
                    <span className="text-xs" style={{ color: "#4ADE80" }}>/10</span>
                  </div>
                ) : (
                  <span className="text-xs px-3 py-1.5 rounded-full" style={{ background: "#F3F4F6", color: "#9CA3AF" }}>
                    대기 중
                  </span>
                )}
              </div>

              {reportLoading ? (
                <div className="py-8 flex items-center justify-center">
                  <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--hb-primary) var(--hb-primary) transparent transparent" }} />
                </div>
              ) : latestReport ? (
                <>
                  <p className="text-sm leading-relaxed text-gray-600 mb-4">{latestReport.summary_line}</p>
                  <div className="flex items-center gap-3 mb-4">
                    <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--hb-muted)" }}>
                      <span>💬</span>
                      <span>대화 {latestReport.session?.turn_count ?? 0}회</span>
                    </span>
                    <span className="w-1 h-1 rounded-full bg-gray-300" />
                    <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--hb-muted)" }}>
                      <span>📊</span>
                      <span>리포트 {reportCount}개</span>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {latestReport.emotion_tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-3 py-1 rounded-full text-xs font-semibold"
                        style={{ background: "var(--hb-primary-light)", color: "var(--hb-primary)" }}
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <div className="py-10 text-center">
                  <p className="text-sm font-semibold text-gray-500">아직 대화 기록이 없어요</p>
                  <p className="text-xs mt-1.5 max-w-xs mx-auto leading-relaxed" style={{ color: "var(--hb-muted)" }}>
                    {activeChild!.name}이가 케이와 대화하면 여기에 리포트가 표시됩니다.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* 오른쪽 또는 서브 열: 메뉴 및 바로가기 카드들 */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {/* 리포트 바로가기 */}
            <Link
              href="/parent/report"
              className="flex items-center justify-between bg-white rounded-2xl p-5 active:opacity-75 transition-opacity hover:shadow-md duration-200"
              style={{ boxShadow: "var(--hb-shadow)" }}
            >
              <div className="flex items-center gap-3.5">
                <span className="text-2xl">📊</span>
                <div>
                  <p className="text-sm font-bold text-gray-900">전체 대화 리포트</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--hb-muted)" }}>
                    {reportCount > 0 ? `${reportCount}개의 리포트가 있어요` : "지난 대화 기록을 확인해요"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs font-semibold" style={{ color: "var(--hb-primary)" }}>보기</span>
                <span style={{ color: "var(--hb-primary)" }}><ChevronRight color="currentColor" /></span>
              </div>
            </Link>

            {/* 오늘의 대화 가이드 카드 */}
            <Link
              href="/parent/guide"
              className="flex items-center justify-between bg-white rounded-2xl p-5 active:opacity-75 transition-opacity hover:shadow-md duration-200"
              style={{ boxShadow: "var(--hb-shadow)" }}
            >
              <div className="flex items-center gap-3.5">
                <span className="text-2xl">📖</span>
                <div>
                  <p className="text-sm font-bold text-gray-900">오늘의 대화 가이드</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--hb-muted)" }}>아이와 더 자연스럽게 대화하기</p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs font-semibold" style={{ color: "var(--hb-primary)" }}>보기</span>
                <span style={{ color: "var(--hb-primary)" }}><ChevronRight color="currentColor" /></span>
              </div>
            </Link>

            {/* 전문가와 연결하기 카드 */}
            <Link
              href="/parent/expert"
              className="flex items-center justify-between bg-white rounded-2xl p-5 active:opacity-75 transition-opacity hover:shadow-md duration-200"
              style={{ boxShadow: "var(--hb-shadow)" }}
            >
              <div className="flex items-center gap-3.5">
                <span className="text-2xl">🔗</span>
                <div>
                  <p className="text-sm font-bold text-gray-900">전문가와 연결하기</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--hb-muted)" }}>아이의 마음을 전문가와 함께 진단</p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs font-semibold" style={{ color: "var(--hb-primary)" }}>보기</span>
                <span style={{ color: "var(--hb-primary)" }}><ChevronRight color="currentColor" /></span>
              </div>
            </Link>
          </div>

        </div>
      </div>

      <DemoSwitcher mode="parent" />
      <ParentTabBar />
    </div>
  );

}
