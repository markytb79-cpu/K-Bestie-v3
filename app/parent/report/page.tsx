"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import ParentTabBar from "@/components/ParentTabBar";
import { BackArrow } from "@/components/ParentIcons";
import DemoSwitcher from "@/components/DemoSwitcher";

interface Report {
  id: string;
  summary_line: string;
  mood_score: number;
  emotion_tags: string[];
  created_at: string;
  session: { started_at: string; turn_count: number } | null;
}


function moodEmoji(score: number) {
  if (score <= 3) return "😢";
  if (score <= 5) return "😔";
  if (score <= 7) return "😊";
  if (score <= 9) return "😄";
  return "🌟";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "방금 전";
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d === 1) return "어제";
  return `${d}일 전`;
}

export default function ParentReportPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [childName, setChildName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = localStorage.getItem("k_child_id");
    if (!id || id.startsWith("demo-")) {
      setLoading(false);
      return;
    }

    Promise.all([
      fetch(`/api/parent/reports?childId=${id}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/child/${encodeURIComponent(id)}`).then((r) => r.ok ? r.json() : null),
    ]).then(([reportData, childData]) => {
      setReports(reportData?.reports ?? []);
      if (childData?.name) setChildName(childData.name);
      else if (reportData?.childName) setChildName(reportData.childName);
    }).catch(() => {})
    .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: "var(--hb-bg)" }}>
        <div className="w-8 h-8 rounded-full animate-pulse" style={{ background: "var(--hb-primary)" }} />
      </div>
    );
  }

  return (
    <div
      className="min-h-dvh pb-[72px] md:max-w-[420px] md:mx-auto"
      style={{ background: "var(--hb-bg)" }}
    >
      {/* 헤더 */}
      <div className="bg-white px-5 pt-12 pb-4 flex items-center gap-3">
        <Link href="/parent/home" style={{ color: "var(--hb-primary)" }}>
          <BackArrow />
        </Link>
        <div>
          <p className="text-xs font-medium" style={{ color: "var(--hb-muted)" }}>
            대화 리포트
          </p>
          <h1 className="text-[17px] font-bold text-gray-900">
            {childName ? `${childName}이 리포트` : "리포트 📊"}
          </h1>
        </div>
        <span
          className="ml-auto text-xs font-semibold px-2.5 py-1 rounded-full"
          style={{ background: "var(--hb-primary-light)", color: "var(--hb-primary)" }}
        >
          {reports.length}개
        </span>
      </div>

      <div className="px-4 py-4 flex flex-col gap-3">
        {reports.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-4">📭</p>
            <p className="text-sm font-semibold text-gray-600">아직 대화 기록이 없어요</p>
            <p className="text-xs mt-2" style={{ color: "var(--hb-muted)" }}>
              케이와 대화하면 리포트가 생성됩니다
            </p>
            <Link
              href="/child/chat"
              className="inline-block mt-5 px-6 py-3 rounded-full text-sm font-bold text-white"
              style={{ background: "var(--hb-primary)" }}
            >
              대화 시작하기
            </Link>
          </div>
        ) : (
          reports.map((r) => (
            <Link
              key={r.id}
              href={`/parent/report/${r.id}`}
              className="block bg-white rounded-2xl p-4 active:opacity-80 transition-opacity"
              style={{ boxShadow: "var(--hb-shadow)" }}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-xs font-medium" style={{ color: "var(--hb-muted)" }}>
                    {formatDate(r.created_at)}
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--hb-muted)" }}>
                    {formatRelative(r.created_at)}
                    {r.session?.turn_count ? ` · 대화 ${r.session.turn_count}회` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{moodEmoji(r.mood_score)}</span>
                  <div
                    className="flex items-baseline gap-0.5 px-2.5 py-1 rounded-full shrink-0"
                    style={{ background: "#DCFCE7" }}
                  >
                    <span className="text-sm font-bold" style={{ color: "#15803D" }}>
                      {r.mood_score}
                    </span>
                    <span className="text-[10px]" style={{ color: "#4ADE80" }}>/10</span>
                  </div>
                </div>
              </div>

              <p className="text-sm font-semibold text-gray-800 leading-snug mb-2.5">
                {r.summary_line}
              </p>

              <div className="flex gap-1.5 flex-wrap">
                {r.emotion_tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="px-2.5 py-0.5 rounded-full text-xs font-medium"
                    style={{ background: "var(--hb-primary-light)", color: "var(--hb-primary)" }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </Link>
          ))
        )}
      </div>

      <DemoSwitcher mode="parent" />
      <ParentTabBar />
    </div>
  );
}
