"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";

interface Report {
  id: string;
  summary_line: string;
  mood_score: number;
  emotion_tags: string[];
  created_at: string;
  session: { started_at: string; turn_count: number } | null;
}

interface Question {
  id: string;
  question_text: string;
  status: "대기중" | "전달됨" | "중지됨";
  created_at: string;
  delivered_count: number;
}


function moodEmoji(score: number) {
  if (score <= 3) return "😢";
  if (score <= 6) return "😊";
  if (score <= 8) return "😄";
  return "🌟";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

export default function ParentPage() {
  const [childId, setChildId] = useState<string | null>(null);
  const [childName, setChildName] = useState<string | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [tab, setTab] = useState<"reports" | "questions">("reports");
  const [loading, setLoading] = useState(true);
  const [qInput, setQInput] = useState("");
  const [qLoading, setQLoading] = useState(false);

  useEffect(() => {
    const id = localStorage.getItem("k_child_id");
    setChildId(id);
    if (!id) { setLoading(false); return; }

    if (id.startsWith("demo-")) {
      setLoading(false);
      return;
    }

    Promise.all([
      fetch(`/api/parent/reports?childId=${id}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/parent/questions?childId=${id}`).then((r) => r.ok ? r.json() : null),
    ])
      .then(([rData, qData]) => {
        setReports(rData?.reports ?? []);
        setChildName(rData?.childName ?? null);
        setQuestions(qData?.questions ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const refreshQuestions = useCallback(() => {
    if (!childId || childId.startsWith("demo-")) return;
    fetch(`/api/parent/questions?childId=${childId}`)
      .then((r) => r.json())
      .then((d) => setQuestions(d.questions ?? []));
  }, [childId]);

  async function addQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (!qInput.trim() || !childId) return;
    setQLoading(true);
    try {
      await fetch("/api/parent/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId, questionText: qInput.trim() }),
      });
      setQInput("");
      refreshQuestions();
    } finally {
      setQLoading(false);
    }
  }

  async function stopQuestion(id: string) {
    await fetch(`/api/parent/questions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "중지됨" }),
    });
    refreshQuestions();
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center"
           style={{ background: "var(--color-parent-bg)" }}>
        <div className="w-8 h-8 rounded-full animate-pulse"
             style={{ background: "var(--color-primary)" }} />
      </div>
    );
  }

  if (!childId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
           style={{ background: "var(--color-parent-bg)" }}>
        <p className="text-4xl mb-4">📭</p>
        <p className="text-lg font-semibold mb-2">등록된 아이가 없어요</p>
        <p className="text-sm mb-6" style={{ color: "var(--color-text-muted)" }}>
          부모 화면에서 아이를 먼저 추가해주세요.
        </p>
        <Link
          href="/onboarding"
          className="px-6 py-3 rounded-full font-medium text-white"
          style={{ background: "var(--color-primary)" }}
        >
          아이 추가하기
        </Link>
      </div>
    );
  }

  return (
    /* PC: max-w-4xl 중앙 정렬 / 모바일: 풀스크린 */
    <div className="min-h-screen flex flex-col md:max-w-4xl md:mx-auto"
         style={{ background: "var(--color-parent-bg)" }}>

      {/* 헤더 */}
      <header className="px-5 pt-10 pb-4 md:pt-8 md:px-8"
              style={{ background: "var(--color-parent-bg)" }}>
        <div className="flex items-center gap-3 mb-1">
          <Image
            src="/character_logo.png"
            alt="케이"
            width={32}
            height={32}
            className="rounded-full object-cover opacity-80"
          />
          <div>
            <p className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
              케이 리포트
            </p>
            <h1 className="text-xl font-bold" style={{ color: "var(--color-primary)" }}>
              {childName ? `${childName} 친구` : "내 아이"}
            </h1>
          </div>
        </div>
        <Link
          href="/chat"
          className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-full text-sm font-semibold text-white transition-opacity active:opacity-80"
          style={{ background: "var(--color-accent)" }}
        >
          <span>🎙️</span> 케이와 대화하기
        </Link>
      </header>

      {/* 탭 */}
      <div className="flex border-b border-gray-200 md:px-4"
           style={{ background: "var(--color-parent-bg)" }}>
        {(["reports", "questions"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-3 text-sm font-semibold transition-colors md:flex-none md:px-6"
            style={
              tab === t
                ? {
                    color: "var(--color-primary)",
                    borderBottom: "2px solid var(--color-primary)",
                    marginBottom: "-1px",
                  }
                : { color: "var(--color-text-muted)" }
            }
          >
            {t === "reports"
              ? `리포트 ${reports.length > 0 ? `(${reports.length})` : ""}`
              : "케이에게 질문"}
          </button>
        ))}
      </div>

      {/* 콘텐츠 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">

        {/* 리포트 탭 */}
        {tab === "reports" && (
          <div className="flex flex-col gap-3 md:grid md:grid-cols-2 md:gap-4">
            {reports.map((r) => (
              <Link
                key={r.id}
                href={`/parent/report/${r.id}`}
                className="block bg-white rounded-2xl p-4 shadow-sm active:opacity-80 transition-opacity hover:shadow-md"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                    {formatDate(r.created_at)}
                  </span>
                  <span className="text-2xl">{moodEmoji(r.mood_score)}</span>
                </div>
                <p className="font-semibold text-sm leading-snug mb-2">{r.summary_line}</p>
                <div className="flex gap-1.5 flex-wrap">
                  {r.emotion_tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2.5 py-0.5 rounded-full text-xs font-medium"
                      style={{ background: "var(--color-child-bg)", color: "var(--color-primary)" }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                {r.session?.turn_count ? (
                  <p className="text-xs mt-2" style={{ color: "var(--color-text-muted)" }}>
                    대화 {r.session.turn_count}회
                  </p>
                ) : null}
              </Link>
            ))}
          </div>
        )}

        {/* 질문 탭 */}
        {tab === "questions" && (
          <div className="flex flex-col gap-4 md:max-w-xl">
            <form onSubmit={addQuestion} className="flex gap-2">
              <input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="케이에게 물어봐 줘요..."
                className="flex-1 px-4 py-3 rounded-2xl bg-white text-sm outline-none border-2 border-transparent focus:border-[#1A6B5A] transition-colors"
                maxLength={100}
              />
              <button
                type="submit"
                disabled={qLoading || !qInput.trim()}
                className="px-4 py-3 rounded-2xl text-white font-bold disabled:opacity-50 shrink-0 transition-opacity"
                style={{ background: "var(--color-primary)" }}
              >
                등록
              </button>
            </form>

            <p className="text-xs px-1" style={{ color: "var(--color-text-muted)" }}>
              등록한 질문은 케이가 대화 중 자연스럽게 전달해요.
            </p>

            {questions.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                  등록된 질문이 없어요
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {questions.map((q) => (
                  <div key={q.id} className="bg-white rounded-xl p-4 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-medium"
                        style={{
                          color: q.status === "중지됨"
                            ? "var(--color-text-muted)"
                            : "var(--color-text-base)",
                        }}
                      >
                        {q.question_text}
                      </p>
                      <p
                        className="text-xs mt-1"
                        style={{
                          color:
                            q.status === "전달됨"
                              ? "#22c55e"
                              : q.status === "중지됨"
                              ? "#9ca3af"
                              : "var(--color-accent)",
                        }}
                      >
                        {q.status === "대기중" && "⏳ 대기 중"}
                        {q.status === "전달됨" && `✅ 전달됨 ${q.delivered_count}회`}
                        {q.status === "중지됨" && "🚫 중지됨"}
                      </p>
                    </div>
                    {q.status === "대기중" && (
                      <button
                        onClick={() => stopQuestion(q.id)}
                        className="text-xs px-3 py-1.5 rounded-full shrink-0"
                        style={{ background: "#f3f4f6", color: "#6b7280" }}
                      >
                        중지
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
