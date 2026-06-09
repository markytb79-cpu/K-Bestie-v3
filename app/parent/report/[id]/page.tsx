"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { BackArrow } from "@/components/ParentIcons";

interface Report {
  id: string;
  summary_line: string;
  mood_score: number;
  emotion_tags: string[];
  parent_guide: string;
  created_at: string;
  session: { started_at: string; turn_count: number; ended_at: string | null } | null;
}


function moodLabel(score: number): { emoji: string; text: string } {
  if (score <= 2) return { emoji: "😢", text: "많이 힘들어 보여요" };
  if (score <= 4) return { emoji: "😔", text: "조금 힘들었던 것 같아요" };
  if (score <= 6) return { emoji: "😊", text: "평온한 하루였어요" };
  if (score <= 8) return { emoji: "😄", text: "즐거운 대화였어요" };
  return { emoji: "🌟", text: "아주 신나는 하루였어요!" };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      <div className="min-h-screen flex items-center justify-center"
           style={{ background: "var(--hb-bg)" }}>
        <div className="w-8 h-8 rounded-full animate-pulse"
             style={{ background: "var(--hb-primary)" }} />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
           style={{ background: "var(--hb-bg)" }}>
        <p className="text-lg font-semibold mb-4">{error ?? "리포트를 불러올 수 없어요"}</p>
        <Link href="/parent/report" className="text-sm underline"
              style={{ color: "var(--hb-primary)" }}>
          목록으로 돌아가기
        </Link>
      </div>
    );
  }

  const mood = moodLabel(report.mood_score);

  return (
    <div
      className="min-h-dvh pb-[72px] lg:pb-12 lg:pl-[240px] w-full transition-all"
      style={{ background: "var(--hb-bg)" }}
    >
      {/* 헤더 */}
      <header className="px-5 pt-12 pb-4 flex items-center gap-3 bg-white">
        <Link href="/parent/report" style={{ color: "var(--hb-primary)" }}>
          <BackArrow />
        </Link>
        <div>
          <p className="text-xs font-medium" style={{ color: "var(--hb-muted)" }}>
            {formatDate(report.created_at)}
          </p>
          <h1 className="text-[17px] font-bold text-gray-900">
            오늘의 리포트
          </h1>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          {/* 왼쪽 열: 분석 정보 */}
          <div className="flex flex-col gap-4">
            {/* 기분 카드 */}
            <div className="bg-white rounded-2xl p-5 flex items-center gap-4 shadow-sm" style={{ boxShadow: "var(--hb-shadow)" }}>
              <span className="text-5xl">{mood.emoji}</span>
              <div>
                <p className="text-2xl font-bold" style={{ color: "var(--hb-primary)" }}>
                  {report.mood_score}점
                </p>
                <p className="text-sm text-gray-600">
                  {mood.text}
                </p>
              </div>
              {/* 기분 바 */}
              <div className="ml-auto flex-shrink-0 w-20">
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${report.mood_score * 10}%`,
                      background: "var(--hb-primary)",
                    }}
                  />
                </div>
                <p className="text-xs text-right mt-1" style={{ color: "var(--hb-muted)" }}>
                  {report.mood_score}/10
                </p>
              </div>
            </div>

            {/* 4분할 분석 카드 */}
            <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ boxShadow: "var(--hb-shadow)" }}>
              <p className="text-xs font-bold mb-4" style={{ color: "var(--hb-muted)" }}>
                오늘의 영역별 분석 📊
              </p>
              <div className="grid grid-cols-2 gap-3.5">
                
                {/* 1. 감정변화 */}
                <div className="p-3.5 rounded-2xl bg-indigo-50/20 border border-gray-100/80 flex flex-col justify-between hover:bg-indigo-50/40 transition-all duration-200">
                  <div>
                    <span className="text-xs font-bold text-gray-400">감정 변화</span>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="text-sm font-bold text-gray-800">
                      {report.mood_score >= 6 ? "🟢 평온" : "🟡 보통"}
                    </span>
                  </div>
                </div>

                {/* 2. 교우관계 */}
                <div className="p-3.5 rounded-2xl bg-indigo-50/20 border border-gray-100/80 flex flex-col justify-between hover:bg-indigo-50/40 transition-all duration-200">
                  <div>
                    <span className="text-xs font-bold text-gray-400">교우 관계</span>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="text-sm font-bold text-gray-800">
                      {report.emotion_tags.some(t => t.includes("친구") || t.includes("싸움") || t.includes("다툼")) ? "🟡 지침" : "🟢 평온"}
                    </span>
                  </div>
                </div>

                {/* 3. 학교스트레스 */}
                <div className="p-3.5 rounded-2xl bg-indigo-50/20 border border-gray-100/80 flex flex-col justify-between hover:bg-indigo-50/40 transition-all duration-200">
                  <div>
                    <span className="text-xs font-bold text-gray-400">학교 스트레스</span>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="text-sm font-bold text-gray-800">
                      {report.emotion_tags.some(t => t.includes("학교") || t.includes("시험") || t.includes("공부") || t.includes("숙제")) ? "🟡 지침" : "🟢 평온"}
                    </span>
                  </div>
                </div>

                {/* 4. 에너지 */}
                <div className="p-3.5 rounded-2xl bg-indigo-50/20 border border-gray-100/80 flex flex-col justify-between hover:bg-indigo-50/40 transition-all duration-200">
                  <div>
                    <span className="text-xs font-bold text-gray-400">에너지 수준</span>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="text-sm font-bold text-gray-800">
                      {report.mood_score >= 7 ? "🟢 활기참" : "🟡 보통"}
                    </span>
                  </div>
                </div>

              </div>
            </div>


            {/* 한 줄 요약 */}
            <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ boxShadow: "var(--hb-shadow)" }}>
              <p className="text-xs font-bold mb-2" style={{ color: "var(--hb-muted)" }}>
                오늘의 대화 요약
              </p>
              <p className="font-semibold text-base leading-snug text-gray-800">{report.summary_line}</p>
              {report.session?.turn_count ? (
                <p className="text-xs mt-2" style={{ color: "var(--hb-muted)" }}>
                  총 {report.session.turn_count}번 대화했어요
                </p>
              ) : null}
            </div>

            {/* 감정 태그 */}
            {report.emotion_tags.length > 0 && (
              <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ boxShadow: "var(--hb-shadow)" }}>
                <p className="text-xs font-bold mb-3" style={{ color: "var(--hb-muted)" }}>
                  감정 키워드
                </p>
                <div className="flex gap-2 flex-wrap">
                  {report.emotion_tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-3 py-1.5 rounded-full text-sm font-medium"
                      style={{ background: "var(--hb-primary-light)", color: "var(--hb-primary)" }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 오른쪽 열: 가이드 및 액션 */}
          <div className="flex flex-col gap-4">
            {/* 부모 가이드 */}
            {report.parent_guide && (
              <div className="rounded-2xl p-5 shadow-sm" style={{ background: "hsl(17 76% 96%)", boxShadow: "var(--hb-shadow)" }}>
                <p className="text-xs font-bold mb-2" style={{ color: "var(--hb-danger)" }}>
                  💡 오늘 이런 이야기를 해보세요
                </p>
                <p className="text-sm font-medium leading-relaxed text-gray-800">{report.parent_guide}</p>
              </div>
            )}

            {/* 다시 대화 CTA */}
            <Link
              href="/child/chat"
              className="block text-center py-4 rounded-2xl font-bold text-white transition-opacity active:opacity-80 shadow-sm"
              style={{ background: "var(--hb-primary)" }}
            >
              🎙️ 오늘도 케이와 대화하기
            </Link>

            {/* AI 고지 */}
            <p className="text-xs text-center px-2 pb-6" style={{ color: "var(--hb-muted)" }}>
              이 리포트는 AI가 생성한 분석으로 참고용입니다. 아이의 실제 감정과 다를 수 있어요.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
