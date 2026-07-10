"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealParentNav } from "@/components/RealParentNav";

type EmotionLevel = "safe" | "warning" | "danger";

interface DashboardCards {
  school_life?: string;
  peer_relations?: string;
  interests?: string;
  study_concerns?: string;
  digital_interests?: string;
  future_dreams?: string;
  recurring_stories?: string;
}

interface Report {
  id: string;
  summary_line: string;
  mood_score: number;
  emotion_tags: string[];
  parent_guide: string;
  emotion_level: EmotionLevel | null;
  dashboard_cards: DashboardCards | null;
  created_at: string;
}

const TABS = [
  { id: 1, label: "빠른 요약" },
  { id: 2, label: "상세 보기" },
  { id: 3, label: "추천 가이드" },
];

function moodLabel(score: number): string {
  if (score <= 2) return "많이 힘들어 보여요";
  if (score <= 4) return "조금 힘들었던 것 같아요";
  if (score <= 6) return "평온한 하루였어요";
  if (score <= 8) return "즐거운 대화였어요";
  return "아주 신나는 하루였어요!";
}

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(1);

  useEffect(() => {
    fetch(`/api/parent/reports/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setReport(d.report);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

    fetch(`/api/parent/reports/${id}/viewed`, { method: "POST" }).catch(() => {});
  }, [id]);

  if (loading) {
    return (
      <DemoFrame>
        <div className="h-full flex items-center justify-center" style={{ background: "#fafaf8" }}>
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#1a6b5a #1a6b5a transparent transparent" }} />
        </div>
      </DemoFrame>
    );
  }

  if (error || !report) {
    return (
      <DemoFrame>
        <div className="h-full flex flex-col items-center justify-center px-6 text-center" style={{ background: "#fafaf8" }}>
          <p className="text-sm font-semibold mb-4 text-red-500">{error ?? "리포트를 불러올 수 없어요"}</p>
          <Link href="/parent/report" className="text-xs underline font-bold" style={{ color: "#1a6b5a" }}>
            목록으로 돌아가기
          </Link>
        </div>
      </DemoFrame>
    );
  }

  const dbCards = report.dashboard_cards ?? {};

  // 빠른 요약 탭
  const Tab1 = () => (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl px-5 py-5" style={{ background: "#fdf1ec" }}>
        <h3 className="font-bold text-base mb-2" style={{ color: "#1e1e2d" }}>
          오늘의 한 줄
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: "#3a3a4a" }}>
          {report.summary_line || "대화 요약이 준비 중입니다."}
        </p>
        <p className="text-[11px] mt-3" style={{ color: "#e8845a" }}>
          AI Insight by 내친구 케이
        </p>
      </div>

      <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
        <h3 className="font-bold text-base mb-2" style={{ color: "#1e1e2d" }}>
          📊 1분 요약 리포트
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: "#3a3a4a" }}>
          {report.parent_guide || "아이가 보낸 하루 대화에 대한 가이드 조언이 생성되지 않았습니다."}
        </p>
      </div>
    </div>
  );

  // 상세 보기 탭
  const Tab2 = () => {
    const sections = [
      { title: "오늘 하루와 주요 사건", body: report.summary_line || "특별한 사건 기록이 없습니다." },
      { title: "그날의 기분", body: `오늘 아이의 기분 점수는 10점 만점에 ${report.mood_score}점입니다. (${moodLabel(report.mood_score)})` },
      { title: "학교와 학원 이야기", body: dbCards.school_life || "오늘은 이 주제의 이야기가 없었어요." },
      { title: "친구 이야기", body: dbCards.peer_relations || "오늘은 친구 관계에 대한 언급이 없었어요." },
      { title: "요즘 관심사", body: dbCards.interests || "오늘은 관심사에 대한 뚜렷한 언급이 없었습니다." },
      { title: "부모님과의 대화에 대한 신호", body: report.parent_guide || "부모님과의 교감 힌트 정보가 아직 생성되지 않았습니다." },
    ];

    return (
      <div className="bg-white rounded-2xl px-5 py-5 shadow-sm flex flex-col gap-5">
        <h3 className="font-bold text-base -mb-2" style={{ color: "#1e1e2d" }}>
          📄 상세 리포트
        </h3>
        {sections.map((section) => (
          <div key={section.title} className="border-b border-gray-50 last:border-0 pb-3 last:pb-0">
            <h4 className="font-bold text-sm mb-1.5" style={{ color: "#1e1e2d" }}>
              {section.title}
            </h4>
            <p className="text-xs leading-relaxed" style={{ color: "#4b5563" }}>
              {section.body}
            </p>
          </div>
        ))}
      </div>
    );
  };

  // 추천 가이드 탭
  const Tab3 = () => {
    // parent_guide에서 질문 후보들을 파싱
    const candidateSentences = report.parent_guide
      ? report.parent_guide
          .split(/[.\n]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 5 && (s.includes("?") || s.endsWith("요") || s.endsWith("까")))
      : [];

    const watchOut = dbCards.recurring_stories || "아이가 대화 중 반복하여 꺼낸 특별한 주말/기타 일정 이야기가 확인되지 않았습니다.";
    const comment = `오늘 아이는 ${dbCards.interests || "케이와의 소소한 일상"} 이야기에 가장 밝게 마음을 열고 대답했습니다.`;

    return (
      <div className="flex flex-col gap-4">
        <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
          <h3 className="font-bold text-base mb-2" style={{ color: "#1e1e2d" }}>
            💬 부모 대화 실마리
          </h3>
          <p className="text-sm leading-relaxed" style={{ color: "#3a3a4a" }}>
            {report.parent_guide || "대화 실마리가 준비 중입니다."}
          </p>
        </div>

        <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
          <h3 className="font-bold text-base mb-3" style={{ color: "#1e1e2d" }}>
            ❓ 부모용 추천 질문
          </h3>
          {candidateSentences.length > 0 ? (
            <ul className="flex flex-col gap-2.5">
              {candidateSentences.slice(0, 5).map((q, i) => (
                <li key={i} className="flex gap-2 text-sm" style={{ color: "#3a3a4a" }}>
                  <span style={{ color: "#22c55e" }}>✓</span>
                  <span>{q}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-400">생성된 질문 가이드가 아직 없습니다.</p>
          )}
        </div>

        <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
          <h3 className="font-bold text-base mb-2" style={{ color: "#3b82f6" }}>
            👁️ 부모가 주의 깊게 볼 변화
          </h3>
          <p className="text-sm leading-relaxed" style={{ color: "#3a3a4a" }}>
            {watchOut}
          </p>
        </div>

        <div className="bg-white rounded-2xl px-5 py-5 shadow-sm">
          <h3 className="font-bold text-base mb-2" style={{ color: "#1e1e2d" }}>
            ✨ 오늘의 케이 코멘트
          </h3>
          <p className="text-sm leading-relaxed" style={{ color: "#3a3a4a" }}>
            {comment}
          </p>
        </div>
      </div>
    );
  };

  const renderTab = () => {
    if (activeTab === 1) return <Tab1 />;
    if (activeTab === 2) return <Tab2 />;
    return <Tab3 />;
  };

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
        {/* 헤더 */}
        <div
          className="shrink-0 flex items-center justify-between px-4 py-4"
          style={{ background: "#fafaf8" }}
        >
          <Link href="/parent/report" className="text-lg cursor-pointer" aria-label="뒤로가기">
            ←
          </Link>
          <span className="font-bold text-sm" style={{ color: "#1a6b5a" }}>
            리포트 상세
          </span>
          <span className="w-5" />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* 탭 버튼들 */}
          <div className="flex gap-2 px-4 pt-4 overflow-x-auto shrink-0 pb-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 px-4 py-2.5 rounded-xl text-xs font-bold text-left transition-colors cursor-pointer ${
                  activeTab === tab.id ? "text-white" : "bg-white"
                }`}
                style={{
                  background: activeTab === tab.id ? "#1a6b5a" : "#ffffff",
                  color: activeTab === tab.id ? "#ffffff" : "#3a3a4a",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 px-4 py-4">{renderTab()}</div>
        </div>

        <RealParentNav />
      </div>
    </DemoFrame>
  );
}
