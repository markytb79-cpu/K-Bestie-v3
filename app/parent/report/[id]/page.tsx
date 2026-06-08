"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";

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
           style={{ background: "var(--color-parent-bg)" }}>
        <div className="w-8 h-8 rounded-full animate-pulse"
             style={{ background: "var(--color-primary)" }} />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
           style={{ background: "var(--color-parent-bg)" }}>
        <p className="text-lg font-semibold mb-4">{error ?? "리포트를 불러올 수 없어요"}</p>
        <Link href="/parent" className="text-sm underline"
              style={{ color: "var(--color-primary)" }}>
          목록으로 돌아가기
        </Link>
      </div>
    );
  }

  const mood = moodLabel(report.mood_score);

  return (
    /* PC: max-w-2xl 중앙 정렬 / 모바일: 풀스크린 */
    <div className="min-h-screen md:max-w-2xl md:mx-auto"
         style={{ background: "var(--color-parent-bg)" }}>

      {/* 헤더 */}
      <header
        className="px-5 pt-10 pb-4 flex items-center gap-3 md:px-6 md:pt-8"
        style={{ background: "var(--color-parent-bg)" }}
      >
        <Link href="/parent" className="text-xl leading-none p-1 -ml-1"
              style={{ color: "var(--color-primary)" }}>
          ←
        </Link>
        <div>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {formatDate(report.created_at)}
          </p>
          <p className="text-sm font-bold" style={{ color: "var(--color-primary)" }}>
            오늘의 리포트
          </p>
        </div>
      </header>

      <div className="px-5 py-4 flex flex-col gap-4 md:px-6 md:py-6">

        {/* 기분 카드 */}
        <div className="bg-white rounded-2xl p-5 flex items-center gap-4 shadow-sm">
          <span className="text-5xl">{mood.emoji}</span>
          <div>
            <p className="text-2xl font-bold" style={{ color: "var(--color-primary)" }}>
              {report.mood_score}점
            </p>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
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
                  background: "var(--color-primary)",
                }}
              />
            </div>
            <p className="text-xs text-right mt-1" style={{ color: "var(--color-text-muted)" }}>
              {report.mood_score}/10
            </p>
          </div>
        </div>

        {/* 한 줄 요약 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-xs font-bold mb-2" style={{ color: "var(--color-text-muted)" }}>
            오늘의 대화 요약
          </p>
          <p className="font-semibold text-base leading-snug">{report.summary_line}</p>
          {report.session?.turn_count ? (
            <p className="text-xs mt-2" style={{ color: "var(--color-text-muted)" }}>
              총 {report.session.turn_count}번 대화했어요
            </p>
          ) : null}
        </div>

        {/* 감정 태그 */}
        {report.emotion_tags.length > 0 && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-bold mb-3" style={{ color: "var(--color-text-muted)" }}>
              감정 키워드
            </p>
            <div className="flex gap-2 flex-wrap">
              {report.emotion_tags.map((tag) => (
                <span
                  key={tag}
                  className="px-3 py-1.5 rounded-full text-sm font-medium"
                  style={{ background: "var(--color-child-bg)", color: "var(--color-primary)" }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 부모 가이드 */}
        {report.parent_guide && (
          <div className="rounded-2xl p-5 shadow-sm" style={{ background: "hsl(17 76% 96%)" }}>
            <p className="text-xs font-bold mb-2" style={{ color: "var(--color-accent)" }}>
              💡 오늘 이런 이야기를 해보세요
            </p>
            <p className="text-sm font-medium leading-relaxed">{report.parent_guide}</p>
          </div>
        )}

        {/* 다시 대화 CTA */}
        <Link
          href="/chat"
          className="block text-center py-4 rounded-2xl font-bold text-white transition-opacity active:opacity-80"
          style={{ background: "var(--color-primary)" }}
        >
          🎙️ 오늘도 케이와 대화하기
        </Link>

        {/* AI 고지 */}
        <p className="text-xs text-center px-2 pb-6" style={{ color: "var(--color-text-muted)" }}>
          이 리포트는 AI가 생성한 분석으로 참고용입니다. 아이의 실제 감정과 다를 수 있어요.
        </p>
      </div>
    </div>
  );
}
