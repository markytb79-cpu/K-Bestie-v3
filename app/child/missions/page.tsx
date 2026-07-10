"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealChildNav } from "@/components/RealChildNav";
import { useGeminiLive, type Turn } from "@/hooks/useGeminiLive";

type RoundType = "round1_day" | "round2_night" | "common";

interface MissionQuestion {
  id: string;
  question_text: string;
  dashboard_area_tag: string;
  cycle_type: string;
  round_type: RoundType;
}

type QuestionState = "pending" | "answered" | "skipped" | "refused";

const REQUIRED_COUNT = 5;

// 운영시간 게이트 (KST)
function getKstHour(): number {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 9 * 3600000).getHours();
}

function currentRound(hour: number): RoundType | null {
  if (hour >= 12 && hour < 17) return "round1_day";
  if (hour >= 19 || hour < 1) return "round2_night";
  return null;
}

function MissionInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [phase, setPhase] = useState<"loading" | "closed" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [childId, setChildId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<MissionQuestion[]>([]);
  const [gauge, setGauge] = useState(0);
  const [completed, setCompleted] = useState(false);

  const sessionIdRef = useRef<string | null>(null);
  const questionsRef = useRef<MissionQuestion[]>([]);
  const currentIndexRef = useRef(0);
  const questionStatesRef = useRef<Record<string, QuestionState>>({});
  const askedIndexRef = useRef<number>(-1);
  const injectedQuestionRef = useRef<string | null>(null);
  const completedRef = useRef(false);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const saveMessage = useCallback((role: "child" | "k", content: string) => {
    const sid = sessionIdRef.current;
    if (!sid || !content.trim()) return;
    fetch("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, role, content }),
    }).catch(() => {});
  }, []);

  const pickNextIndex = useCallback((states: Record<string, QuestionState>): number => {
    const qs = questionsRef.current;
    const cur = currentIndexRef.current;
    for (let i = cur + 1; i < qs.length; i++) {
      if ((states[qs[i].id] ?? "pending") === "pending") return i;
    }
    for (let i = 0; i < qs.length; i++) {
      if ((states[qs[i].id] ?? "pending") === "skipped") return i;
    }
    return -1;
  }, []);

  const handleTurnComplete = useCallback((turn: Turn) => {
    if (turn.role === "child" && injectedQuestionRef.current && turn.text === injectedQuestionRef.current) {
      injectedQuestionRef.current = null;
      return;
    }

    saveMessage(turn.role, turn.text);

    if (turn.role !== "child" || completedRef.current) return;

    const qs = questionsRef.current;
    const idx = currentIndexRef.current;
    const question = qs[idx];
    const sid = sessionIdRef.current;
    if (!question || !sid) return;

    void (async () => {
      try {
        const res = await fetch("/api/mission/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid, questionId: question.id, answerText: turn.text }),
        });
        if (!res.ok) return;
        const data = await res.json();
        questionStatesRef.current = data.questionStates ?? questionStatesRef.current;
        setGauge(data.validAnswerCount ?? 0);

        if (data.completed) {
          completedRef.current = true;
          setCompleted(true);
          return;
        }

        const next = pickNextIndex(questionStatesRef.current);
        if (next === -1) return;
        currentIndexRef.current = next;
      } catch {
        // 에러 시 재시도
      }
    })();
  }, [saveMessage, pickNextIndex]);

  const { status, error, transcript, startSession, stopSession, sendText } = useGeminiLive({
    onTurnComplete: handleTurnComplete,
    sttMode: "gcp",
  });

  useEffect(() => {
    const qpChild = searchParams.get("childId");
    const stored = typeof window !== "undefined" ? localStorage.getItem("k_child_id") : null;
    const cid = qpChild || stored;
    if (!cid) {
      router.replace("/");
      return;
    }
    setChildId(cid);

    const hour = getKstHour();
    const qpRound = searchParams.get("roundType") as RoundType | null;
    const round: RoundType | null = qpRound ?? currentRound(hour);
    if (!round) {
      setPhase("closed");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/mission/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ childId: cid, roundType: round }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setErrorMsg(data.error ?? "미션을 시작하지 못했어요");
          setPhase("error");
          return;
        }
        setSessionId(data.sessionId);
        sessionIdRef.current = data.sessionId;
        const qs: MissionQuestion[] = data.questions ?? [];
        setQuestions(qs);
        questionsRef.current = qs;
        const initStates: Record<string, QuestionState> = {};
        for (const q of qs) initStates[q.id] = "pending";
        questionStatesRef.current = initStates;
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        setErrorMsg((e as Error).message);
        setPhase("error");
      }
    })();
    return () => { cancelled = true; };
  }, [searchParams, router]);

  useEffect(() => {
    if (phase === "ready" && status === "idle") {
      startSession();
    }
  }, [phase, status, startSession]);

  useEffect(() => {
    if (status !== "live" || completed) return;
    const idx = currentIndexRef.current;
    if (askedIndexRef.current === idx) return;
    const q = questionsRef.current[idx];
    if (!q) return;
    askedIndexRef.current = idx;
    injectedQuestionRef.current = q.question_text;
    sendText(q.question_text);
  }, [status, transcript, completed, sendText]);

  useEffect(() => {
    if (completed) stopSession();
  }, [completed, stopSession]);

  useEffect(() => {
    bubbleRef.current?.scrollTo({ top: bubbleRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript]);

  if (phase === "loading") {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: "#fafaf8" }}>
        <p className="text-sm font-bold text-gray-700 animate-pulse">미션을 준비하고 있어요…</p>
      </div>
    );
  }

  if (phase === "closed") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 p-6 text-center" style={{ background: "#fafaf8" }}>
        <p className="text-5xl">⏰</p>
        <p className="text-base font-bold text-gray-800">지금은 미션 시간이 아니에요</p>
        <p className="text-xs text-gray-500 leading-relaxed">
          1차 미션은 낮 12시~5시,
          <br />
          2차 미션은 저녁 7시~새벽 1시에 만나요!
        </p>
        <button
          onClick={() => router.replace("/child/home")}
          className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform cursor-pointer"
          style={{ background: "#1a6b5a" }}
        >
          홈으로 돌아가기
        </button>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 p-6 text-center" style={{ background: "#fafaf8" }}>
        <p className="text-5xl text-red-500">⚠️</p>
        <p className="text-base font-bold text-red-500">미션을 시작하지 못했어요</p>
        <p className="text-xs text-gray-500">{errorMsg}</p>
        <button
          onClick={() => router.replace("/child/home")}
          className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform cursor-pointer"
          style={{ background: "#1a6b5a" }}
        >
          홈으로 돌아가기
        </button>
      </div>
    );
  }

  const isConnecting = status === "connecting";
  const isLive = status === "live";
  const isDone = completed || gauge >= REQUIRED_COUNT;
  const missionPercent = Math.min(gauge * 20, 100);

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "#fafaf8" }}>
      {/* 상단 고정 영역: 헤더 + 진행률 게이지 + 마스코트 (스크롤되지 않음) */}
      <div className="shrink-0 sticky top-0 z-10" style={{ background: "#fafaf8" }}>
        <div className="flex items-center justify-center px-4 pt-4 pb-2">
          <Link
            href="/child/home"
            className="font-bold text-sm cursor-pointer"
            style={{ color: "#1a6b5a" }}
          >
            내친구 케이
          </Link>
        </div>

        <div className="text-center pt-2 pb-4">
          <h1 className="text-lg font-bold" style={{ color: "#1e1e2d" }}>
            {isDone ? "오늘의 미션을 완료했어요!" : isConnecting ? "케이를 부르는 중이에요…" : "케이가 듣고 있어요…"}
          </h1>
          <p className="text-xs mt-1" style={{ color: "#6b7280" }}>
            {isDone ? "황금열쇠를 받았어요. 내일 또 만나요! 🔑" : "질문에 편하게 대답해 보세요"}
          </p>

          <div className="px-6 mt-3">
            <p className="text-xs font-bold" style={{ color: "#1a6b5a" }}>
              미션 진행 {missionPercent}% ({gauge}/{REQUIRED_COUNT})
            </p>
            <div className="mt-1.5 h-2.5 rounded-full bg-gray-200 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${missionPercent}%`,
                  background: "linear-gradient(90deg, #1a6b5a 0%, #2a8a72 100%)",
                }}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-center mb-4">
          <div className="w-24 h-24 rounded-full bg-white shadow-sm flex items-center justify-center overflow-hidden border border-gray-50">
            <Image
              src="/Images/mascot/mascot-standing.png"
              alt="케이 마스코트"
              width={80}
              height={80}
              className="object-contain"
              priority
            />
          </div>
        </div>
      </div>

      {/* 대화 말풍선: 이 영역만 스크롤 */}
      <div
        ref={bubbleRef}
        className="flex-1 min-h-0 px-4 flex flex-col gap-3 overflow-y-auto pb-4"
      >
        {transcript.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center p-4">
            <p className="text-xs" style={{ color: "#9ca3af" }}>
              곧 케이가 첫 질문을 해줄 거예요 🌿
            </p>
          </div>
        ) : (
          transcript.map((turn, i) => (
            <div
              key={i}
              className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                turn.role === "k" ? "self-start" : "self-end"
              }`}
              style={{
                background: turn.role === "k" ? "#f3f4f6" : "#3b82f6",
                color: turn.role === "k" ? "#1e1e2d" : "#ffffff",
                borderRadius: turn.role === "k" ? "16px 16px 16px 2px" : "16px 16px 2px 16px",
              }}
            >
              {turn.text}
            </div>
          ))
        )}
      </div>

      {/* 하단 버튼 바 */}
      <div className="flex items-center justify-center gap-8 py-5 shrink-0 bg-white border-t border-gray-50">
        <button
          disabled
          className="w-11 h-11 rounded-full flex items-center justify-center bg-white shadow-sm text-lg opacity-50 cursor-not-allowed"
          aria-label="텍스트로 대화하기"
        >
          💬
        </button>
        
        {isConnecting && (
          <button disabled className="w-16 h-16 rounded-full flex items-center justify-center bg-gray-100 shadow-sm cursor-not-allowed">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
          </button>
        )}

        {isLive && !isDone && (
          <div className="relative flex items-center justify-center">
            <div className="absolute w-16 h-16 rounded-full bg-orange-400/20 animate-ping pointer-events-none" />
            <button
              onClick={() => stopSession()}
              className="relative w-16 h-16 rounded-full flex items-center justify-center text-white shadow-md transition-transform active:scale-95 cursor-pointer bg-gradient-to-br from-orange-400 to-orange-500"
              aria-label="마이크 끄기"
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="white">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          </div>
        )}

        {!isLive && !isConnecting && !isDone && (
          <button
            onClick={() => startSession()}
            className="w-16 h-16 rounded-full flex items-center justify-center text-2xl text-white shadow-md transition-transform active:scale-95 cursor-pointer"
            style={{ background: "#e8845a" }}
            aria-label="마이크 켜기"
          >
            🎤
          </button>
        )}

        {isDone && (
          <button
            onClick={() => router.replace("/child/home")}
            className="w-16 h-16 rounded-full flex items-center justify-center text-white shadow-md transition-transform active:scale-95 cursor-pointer"
            style={{ background: "#1a6b5a" }}
            aria-label="홈으로 이동"
          >
            ✕
          </button>
        )}

        <button
          onClick={() => {
            stopSession();
            router.replace("/child/home");
          }}
          className="w-11 h-11 rounded-full flex items-center justify-center bg-white shadow-sm text-lg cursor-pointer"
          aria-label="닫기"
        >
          ✕
        </button>
      </div>

      <RealChildNav active="미션" />
    </div>
  );
}

export default function ChildMissionsPage() {
  return (
    <Suspense fallback={null}>
      <DemoFrame>
        <MissionInner />
      </DemoFrame>
    </Suspense>
  );
}
