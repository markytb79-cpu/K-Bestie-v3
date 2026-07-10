"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealParentNav } from "@/components/RealParentNav";

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
    if (!id) {
      setLoading(false);
      return;
    }

    Promise.all([
      fetch(`/api/parent/reports?childId=${id}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/child/${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([reportData, childData]) => {
        setReports(reportData?.reports ?? []);
        if (childData?.name) setChildName(childData.name);
        else if (reportData?.childName) setChildName(reportData.childName);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <DemoFrame>
        <div className="h-full flex items-center justify-center" style={{ background: "#fafaf8" }}>
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#1a6b5a #1a6b5a transparent transparent" }} />
        </div>
      </DemoFrame>
    );
  }

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
        {/* 헤더 */}
        <div className="shrink-0 flex items-center justify-between px-4 py-4" style={{ background: "#fafaf8" }}>
          <Link href="/parent/home" className="text-lg cursor-pointer" aria-label="뒤로가기">
            ←
          </Link>
          <span className="font-bold text-sm" style={{ color: "#1a6b5a" }}>
            {childName ? `${childName}의 대화 리포트` : "대화 리포트"}
          </span>
          <span className="text-xs font-semibold px-2 py-0.5 bg-gray-100 rounded-full text-gray-500">
            {reports.length}개
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          {reports.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl shadow-sm">
              <p className="text-4xl mb-4">📭</p>
              <p className="text-sm font-semibold text-gray-600">아직 대화 기록이 없어요</p>
              <p className="text-xs mt-2 text-gray-400">
                케이와 대화하면 리포트가 생성됩니다
              </p>
            </div>
          ) : (
            reports.map((r) => (
              <Link
                key={r.id}
                href={`/parent/report/${r.id}`}
                className="block bg-white rounded-2xl p-4 active:scale-[0.99] transition-transform shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-xs font-bold text-gray-500">
                      {formatDate(r.created_at)}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {formatRelative(r.created_at)}
                      {r.session?.turn_count ? ` · 대화 ${r.session.turn_count}회` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl select-none">{moodEmoji(r.mood_score)}</span>
                    <div
                      className="flex items-baseline gap-0.5 px-2.5 py-0.5 rounded-full shrink-0"
                      style={{ background: "#DCFCE7" }}
                    >
                      <span className="text-xs font-bold" style={{ color: "#15803D" }}>
                        {r.mood_score}
                      </span>
                      <span className="text-[9px]" style={{ color: "#4ADE80" }}>/10</span>
                    </div>
                  </div>
                </div>

                <p className="text-xs font-bold text-gray-800 leading-snug mb-2.5">
                  "{r.summary_line}"
                </p>

                <div className="flex gap-1.5 flex-wrap">
                  {r.emotion_tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                      style={{ background: "#fdf1ec", color: "#e8845a" }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </Link>
            ))
          )}
        </div>

        <RealParentNav active="리포트" />
      </div>
    </DemoFrame>
  );
}
