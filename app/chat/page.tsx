"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useGeminiLive, type Turn } from "@/hooks/useGeminiLive";

// ── 아이콘 ────────────────────────────────────────────────────
function IconSpeaker({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={size} height={size}>
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
    </svg>
  );
}
function IconSend() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={20} height={20}>
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  );
}
function IconMic({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="white" width={size} height={size}>
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
    </svg>
  );
}
function IconStop() {
  return (
    <svg viewBox="0 0 24 24" fill="white" width={26} height={26}>
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  );
}
function IconKeyboard() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor">
      <path d="M20 5H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 5H5v-2h2v2zm10 0H9v-2h8v2zm0-3h-2v-2h2v2zm0-3h-2V8h2v2zm-3 3h-2v-2h2v2zm0-3h-2V8h2v2z" />
    </svg>
  );
}
function IconMicSmall() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor">
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
    </svg>
  );
}
function IconChatBubble({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={size} height={size}>
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z" />
    </svg>
  );
}
function IconClose({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  );
}

function speakText(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = "ko-KR";
  utt.rate = 1.05;
  window.speechSynthesis.speak(utt);
}

// ── 버블 컴포넌트 ─────────────────────────────────────────────
function BubbleItem({ turn, showSpeaker = false }: { turn: Turn; showSpeaker?: boolean }) {
  if (turn.role === "k") {
    return (
      <div className="flex justify-start">
        <div className="flex flex-col items-start gap-1" style={{ maxWidth: "74%" }}>
          <div className="rounded-2xl rounded-tl-sm px-4 py-3"
            style={{ background: "var(--color-primary)" }}>
            <p className="text-sm leading-relaxed text-white">{turn.text}</p>
          </div>
          {showSpeaker && (
            <button
              onClick={() => speakText(turn.text)}
              className="flex items-center gap-1 px-2 py-1 rounded-full text-xs active:opacity-60"
              style={{ color: "var(--color-text-muted)" }}
              aria-label="케이 목소리로 듣기"
            >
              <IconSpeaker size={13} />
              <span>듣기</span>
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-end">
      <div className="rounded-2xl rounded-tr-sm px-4 py-3"
        style={{ background: "white", maxWidth: "74%", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
        <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-base)" }}>
          {turn.text}
        </p>
      </div>
    </div>
  );
}

function VoiceBubbleItem({ turn }: { turn: Turn }) {
  if (turn.role === "k") {
    return (
      <div className="flex justify-start items-start gap-2.5 my-1.5 w-full">
        <div className="shrink-0 w-8 h-8 rounded-full overflow-hidden border border-gray-200 bg-white">
          <Image src="/character_logo.png" alt="케이" width={32} height={32} className="object-cover" />
        </div>
        <div className="flex flex-col items-start gap-1 max-w-[70%]">
          <span className="text-[11px] font-bold text-gray-500 ml-1">케이</span>
          <div className="rounded-2xl rounded-tl-sm px-4 py-2.5 bg-gray-200 shadow-sm">
            <p className="text-[13px] leading-relaxed text-gray-800 font-medium whitespace-pre-wrap">{turn.text}</p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-end my-1.5 w-full">
      <div className="rounded-2xl rounded-tr-sm px-4 py-2.5 bg-blue-500 text-white shadow-sm max-w-[70%]">
        <p className="text-[13px] leading-relaxed font-medium whitespace-pre-wrap">{turn.text}</p>
      </div>
    </div>
  );
}

type ChatMode = "voice" | "text";

export default function ChatPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [childId, setChildId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [reportDone, setReportDone] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [clockTime, setClockTime] = useState("");
  const [mode, setMode] = useState<ChatMode>("voice");
  const [textInput, setTextInput] = useState("");
  const [showExitModal, setShowExitModal] = useState(false);

  const pendingTextRef = useRef<string | null>(null);
  const voiceBubbleRef = useRef<HTMLDivElement>(null);
  const textBubbleRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);

  // ── 실시간 메시지 저장 ──────────────────────────────────────
  const handleTurnComplete = useCallback((turn: Turn) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    fetch("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, role: turn.role, content: turn.text }),
    }).catch(() => {});
  }, []);

  const {
    status: rawStatus, error, transcript,
    startSession, stopSession, pauseSession, getTranscript, reset,
    sendText, setAudioMuted, setMicEnabled,
  } = useGeminiLive({ onTurnComplete: handleTurnComplete });

  const status = mounted ? rawStatus : "idle";
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const getSupabase = useCallback(() => {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }, []);

  useEffect(() => {
    const fmt = () =>
      new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    setClockTime(fmt());
    const id = setInterval(() => setClockTime(fmt()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    reset();
    localStorage.removeItem("k_session_id");
    setSessionId(null);
    sessionIdRef.current = null;
    setReportDone(false);
    setReportError(null);
    setMounted(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("k_child_id");
    if (stored) { setChildId(stored); return; }
    router.replace("/");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status === "live" && pendingTextRef.current) {
      sendText(pendingTextRef.current);
      pendingTextRef.current = null;
    }
  }, [status, sendText]);

  useEffect(() => {
    if (status !== "ended" || !sessionId) return;
    const t = getTranscript();
    fetch("/api/report/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, transcript: t }),
    })
      .then((r) => r.json())
      .then((d) => { if (d.error) setReportError(d.error); else setReportDone(true); })
      .catch((e) => setReportError(e.message));
  }, [status, sessionId, getTranscript]);

  useEffect(() => {
    const ref = mode === "voice" ? voiceBubbleRef : textBubbleRef;
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [transcript, mode]);

  // ── 핸들러 ────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    reset();
    localStorage.removeItem("k_session_id");
    setSessionId(null);
    sessionIdRef.current = null;
    setReportDone(false);
    setReportError(null);
  }, [reset]);

  const handleRestart = useCallback(async () => {
    reset();
    localStorage.removeItem("k_session_id");
    setSessionId(null);
    sessionIdRef.current = null;
    setReportDone(false);
    setReportError(null);

    if (!childId) return;
    const { data } = await getSupabase()
      .from("chat_sessions")
      .insert({ child_id: childId })
      .select("id")
      .single();
    if (data) {
      setSessionId(data.id);
      sessionIdRef.current = data.id;
      localStorage.setItem("k_session_id", data.id);
    }
    await startSession();
  }, [childId, reset, startSession, getSupabase]);

  const handleStart = useCallback(async () => {
    if (!childId) return;
    setReportDone(false);
    setReportError(null);

    if (status === "paused" && sessionIdRef.current) {
      await startSession({ preserveHistory: true });
      return;
    }


    const { data } = await getSupabase()
      .from("chat_sessions")
      .insert({ child_id: childId })
      .select("id")
      .single();
    if (data) {
      setSessionId(data.id);
      sessionIdRef.current = data.id;
      localStorage.setItem("k_session_id", data.id);
    }
    await startSession();
  }, [childId, startSession, status, getSupabase]);

  const handlePause = useCallback(async () => {
    pauseSession();
    const sid = sessionIdRef.current;
    if (sid) {
      const turnCount = getTranscript().filter((t) => t.role === "child").length;
      fetch("/api/chat/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, turnCount }),
      }).catch(() => {});
    }
  }, [pauseSession, getTranscript]);

  const handleSendText = useCallback(async () => {
    const text = textInput.trim();
    if (!text || !childId) return;
    setTextInput("");
    if (status === "live") {
      sendText(text);
    } else if (status === "idle" || status === "error") {
      pendingTextRef.current = text;
      setMicEnabled(false);
      await handleStart();
    }
  }, [textInput, childId, status, sendText, setMicEnabled, handleStart]);

  const switchToText = useCallback(() => {
    setMode("text");
    setAudioMuted(true);
    setMicEnabled(false);
  }, [setAudioMuted, setMicEnabled]);

  const switchToVoice = useCallback(() => {
    setMode("voice");
    setAudioMuted(false);
    setMicEnabled(true);
  }, [setAudioMuted, setMicEnabled]);

  // ── 상태 플래그 ───────────────────────────────────────────
  const isIdle       = status === "idle";
  const isConnecting = status === "connecting";
  const isLive       = status === "live";
  const isPaused     = status === "paused";
  const isActive     = isConnecting || isLive;
  const isEnded      = status === "ended" || status === "ending";
  const isError      = status === "error";

  const latestK = [...transcript].reverse().find((t) => t.role === "k");

  const captionText = isConnecting
    ? "연결하는 중... ✨"
    : isLive
    ? (latestK?.text ?? "")
    : isPaused
    ? "케이와의 대화가 중단되었습니다."
    : isEnded
    ? (reportDone ? "리포트가 완성됐어요 🎉" : "대화가 끝났어요")
    : isError
    ? `오류: ${error}`
    : "케이가 기다리고 있어! 👋";

  const micDisabled  = isConnecting || !childId || isEnded;
  const textDisabled = !childId || isEnded || isPaused || isConnecting;

  // ── 공용 헤더 ─────────────────────────────────────────────
  const Header = (
    <header
      className="shrink-0 h-14 flex items-center justify-between px-4 relative"
      style={{ background: mode === "voice" ? "var(--color-child-bg)" : "var(--color-parent-bg)" }}
    >
      <button
        onClick={() => router.replace("/child/home")}
        className="p-2 -ml-1 text-xl leading-none font-light"
        style={{ color: "var(--color-primary)" }}
        aria-label="뒤로가기"
      >
        ←
      </button>
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5">
        <Image src="/character_logo.png" alt="" width={22} height={22} className="rounded-full object-cover" />
        <span className="text-sm font-bold" style={{ color: "var(--color-primary)" }}>케이</span>
        <span
          className="w-2 h-2 rounded-full transition-colors duration-300"
          style={{ background: isLive ? "#22c55e" : isConnecting ? "#f59e0b" : "#d1d5db" }}
        />
      </div>
      <span className="text-xs font-semibold tabular-nums" style={{ color: "var(--color-text-muted)" }}>
        {clockTime}
      </span>
    </header>
  );

  // ── 모드 전환 FAB ─────────────────────────────────────────
  const ModeToggleFAB = (
    <button
      onClick={mode === "voice" ? switchToText : switchToVoice}
      className="w-12 h-12 rounded-full flex items-center justify-center transition-transform active:scale-90"
      style={{
        background: mode === "text" ? "var(--color-primary)" : "white",
        color: mode === "text" ? "white" : "var(--color-primary)",
        boxShadow: "0 3px 14px rgba(0,0,0,0.18)",
      }}
      aria-label={mode === "voice" ? "텍스트 모드로 전환" : "음성 모드로 전환"}
    >
      {mode === "voice" ? <IconKeyboard /> : <IconMicSmall />}
    </button>
  );

  // ── 종료/일시정지 안내 ────────────────────────────────────
  const EndedNotice = isEnded ? (
    <div className="text-center py-4 flex flex-col items-center gap-3">
      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
        {reportDone
          ? "리포트가 완성됐어요 🎉"
          : reportError
          ? "리포트 생성에 실패했어요"
          : "대화가 끝났어요"}
      </p>
      {reportDone && (
        <button
          onClick={() => router.push("/parent")}
          className="px-6 py-2.5 rounded-full font-bold text-white text-sm active:opacity-80 transition-opacity"
          style={{ background: "var(--color-primary)" }}
        >
          부모 리포트 보러 가기 →
        </button>
      )}
      <button
        onClick={handleReset}
        className="px-5 py-2 text-xs rounded-full transition-opacity active:opacity-70"
        style={{ color: "var(--color-text-muted)", background: "rgba(0,0,0,0.06)" }}
      >
        새 대화 시작
      </button>
    </div>
  ) : isPaused ? (
    <div className="text-center py-3">
      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>일시정지 중</p>
    </div>
  ) : null;

  // ── 음성 모드 콘텐츠 ──────────────────────────────────────
  const voiceContent = (
    <div
      className="flex flex-col h-full overflow-hidden select-none"
      style={{ background: "var(--color-child-bg)", fontFamily: "var(--font-child)" }}
    >
      {/* 상단 헤더 */}
      <header className="shrink-0 h-14 flex items-center justify-between px-4 relative bg-white/30 backdrop-blur-sm border-b border-black/5">
        <button
          onClick={() => router.replace("/child/home")}
          className="p-2 -ml-1 text-xl leading-none font-bold text-gray-600 hover:text-gray-900"
          aria-label="뒤로가기"
        >
          ←
        </button>
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5">
          <Image src="/character_logo.png" alt="" width={22} height={22} className="rounded-full object-cover" />
          <span className="text-sm font-bold text-gray-700">내친구케이</span>
          <span
            className="w-2.5 h-2.5 rounded-full transition-colors duration-300"
            style={{ background: isLive ? "#22c55e" : isConnecting ? "#f59e0b" : "#d1d5db" }}
          />
        </div>
        <span className="text-xs font-semibold text-gray-500 tabular-nums">
          {clockTime}
        </span>
      </header>

      {/* 세로 한 컬럼 본문 영역 */}
      <div className="flex-1 flex flex-col items-center justify-between p-4 min-h-0 overflow-hidden">
        
        {/* 상태 문구 영역 */}
        <div className="text-center py-2 shrink-0">
          {isConnecting && (
            <p className="text-base font-bold text-gray-700 animate-pulse">케이를 부르는 중이에요…</p>
          )}
          {isLive && (
            <div className="flex flex-col gap-0.5">
              <p className="text-base font-bold text-gray-800">케이가 듣고 있어요…</p>
              <p className="text-xs text-gray-500">자유롭게 이야기해 보세요</p>
            </div>
          )}
          {isPaused && (
            <p className="text-base font-bold text-gray-700">잠깐 멈췄어요. 다시 이야기하려면 눌러요</p>
          )}
          {isEnded && (
            <p className="text-base font-bold text-gray-700">오늘 케이와의 대화가 끝났어요</p>
          )}
          {isError && (
            <p className="text-sm font-bold text-red-500">오류: {error}</p>
          )}
          {isIdle && (
            <p className="text-base font-bold text-gray-700">케이가 기다리고 있어! 👋</p>
          )}
        </div>

        {/* 가운데 캐릭터 카드 */}
        <div className="my-3 shrink-0 flex items-center justify-center">
          <div 
            className="relative bg-white rounded-3xl p-6 flex items-center justify-center w-36 h-36 border border-gray-100 transition-all duration-500"
            style={{
              boxShadow: isLive 
                ? "0 10px 30px -5px rgba(218, 119, 73, 0.25), 0 0 20px 2px rgba(218, 119, 73, 0.15)"
                : "0 10px 25px -5px rgba(0, 0, 0, 0.08)",
              transform: isLive ? "scale(1.03)" : "scale(1)"
            }}
          >
            {isLive && !latestK ? (
              <div className="k-typing">
                <span /><span /><span />
              </div>
            ) : (
              <Image
                src="/character_logo.png"
                alt="케이"
                width={88}
                height={88}
                className="object-contain"
                style={{
                  filter: isLive ? "drop-shadow(0 0 8px rgba(218, 119, 73, 0.3))" : "none"
                }}
                priority
              />
            )}
          </div>
        </div>

        {/* 대화 말풍선 세로 스크롤 영역 */}
        <div
          ref={voiceBubbleRef}
          className="flex-1 w-full max-w-md my-2 overflow-y-auto px-3 py-2 flex flex-col gap-1.5 bg-white/20 rounded-2xl border border-black/5"
        >
          {transcript.length === 0 ? (
            <div className="flex items-center justify-center h-full text-center p-4">
              <p className="text-xs text-gray-400">
                {isIdle ? "마이크 버튼을 눌러 대화를 시작해보세요!" : "곧 대화 내역이 여기에 표시돼요"}
              </p>
            </div>
          ) : (
            transcript.map((turn, i) => (
              <VoiceBubbleItem key={i} turn={turn} />
            ))
          )}
        </div>

        {/* 맨 아래 컨트롤 버튼 영역 */}
        <div className="w-full max-w-md shrink-0 pt-2 pb-4 flex items-center justify-between px-6 relative h-24">
          {/* 텍스트 전환 버튼 (왼쪽) */}
          <div className="w-12 h-12 flex items-center justify-center">
            {!isEnded && (
              <button
                onClick={switchToText}
                disabled={isConnecting}
                className="w-10 h-10 rounded-full flex items-center justify-center bg-white text-[#1A6B5A] shadow-md border border-gray-100 active:scale-90 transition-transform disabled:opacity-40"
                aria-label="텍스트 모드로 전환"
              >
                <IconChatBubble />
              </button>
            )}
          </div>

          {/* 가운데 마이크 버튼 or 종료 후 재시작/홈 버튼 */}
          <div className="flex-1 flex justify-center items-center">
            {isConnecting && (
              <button
                disabled
                className="w-16 h-16 rounded-full flex items-center justify-center bg-gray-200 text-gray-400 border border-gray-300 cursor-not-allowed"
              >
                <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
              </button>
            )}
            
            {isLive && (
              <div className="relative flex items-center justify-center">
                {/* 은은한 펄스 링 */}
                <div className="absolute w-16 h-16 rounded-full bg-orange-400/30 animate-ripple pointer-events-none" />
                <div className="absolute w-16 h-16 rounded-full bg-orange-400/20 animate-ripple-delay pointer-events-none" />
                <button
                  onClick={handlePause}
                  className="relative w-16 h-16 rounded-full flex items-center justify-center text-white bg-gradient-to-br from-orange-400 to-orange-600 shadow-lg active:scale-95 transition-transform"
                  aria-label="대화 일시정지"
                >
                  <IconStop />
                </button>
              </div>
            )}

            {isPaused && (
              <button
                onClick={handleStart}
                className="w-16 h-16 rounded-full flex items-center justify-center text-white bg-gray-400 hover:bg-gray-500 shadow-md active:scale-95 transition-transform"
                aria-label="대화 재개"
              >
                <IconMic size={24} />
              </button>
            )}

            {isIdle && (
              <button
                onClick={handleStart}
                className="w-16 h-16 rounded-full flex items-center justify-center text-white bg-[#DA7749] hover:bg-[#c96437] shadow-lg active:scale-95 transition-transform"
                aria-label="대화 시작"
              >
                <IconMic size={24} />
              </button>
            )}

            {isEnded && (
              <div className="flex gap-2">
                <button
                  onClick={handleRestart}
                  className="px-4 py-2 rounded-xl font-bold text-white text-xs bg-[#1A6B5A] active:scale-95 transition-transform shadow-md"
                >
                  다시 시작하기
                </button>
                <button
                  onClick={() => router.replace("/child/home")}
                  className="px-4 py-2 rounded-xl font-bold text-gray-700 text-xs bg-gray-200 active:scale-95 transition-transform shadow-md"
                >
                  홈으로
                </button>
              </div>
            )}
          </div>

          {/* 종료(X) 버튼 (오른쪽) */}
          <div className="w-12 h-12 flex items-center justify-center">
            {!isEnded && (
              <button
                onClick={() => setShowExitModal(true)}
                className="w-10 h-10 rounded-full flex items-center justify-center bg-white text-gray-500 hover:text-gray-800 shadow-md border border-gray-100 active:scale-90 transition-transform"
                aria-label="대화 종료"
              >
                <IconClose />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // ── 텍스트 모드 콘텐츠 ────────────────────────────────────
  const textContent = (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: "var(--color-parent-bg)", fontFamily: "var(--font-base)" }}
    >
      {Header}

      <div
        ref={textBubbleRef}
        className="flex-1 overflow-y-auto px-4 py-4 flex flex-col"
      >
        <div className="max-w-3xl mx-auto w-full flex-1 flex flex-col gap-3 justify-start">
          {transcript.length === 0 && !isConnecting && (
            <div className="flex flex-col items-center justify-center h-full gap-3 pb-10">
              <Image src="/character_logo.png" alt="" width={80} height={80} className="object-contain opacity-60" />
              <p className="text-sm font-medium" style={{ color: "var(--color-text-muted)" }}>
                아래에 메시지를 입력하면 케이가 답해줄 거야!
              </p>
            </div>
          )}

          {isConnecting && transcript.length === 0 && (
            <div className="flex justify-start">
              <div className="rounded-2xl px-4 py-3"
                style={{ background: "var(--color-primary)", maxWidth: "72%" }}>
                <p className="text-sm text-white">잠깐만 기다려 줘 🌟</p>
              </div>
            </div>
          )}

          {transcript.map((turn, i) => (
            <BubbleItem key={i} turn={turn} showSpeaker={turn.role === "k"} />
          ))}
          {EndedNotice}
        </div>
      </div>

      {/* 입력창 */}
      <div
        className="shrink-0 border-t bg-gray-50/50"
        style={{
          borderColor: "rgba(0,0,0,0.07)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
        }}
      >
        <div className="max-w-3xl mx-auto px-4 pt-3 flex gap-2 items-center w-full">
          <div className="shrink-0">{ModeToggleFAB}</div>
          <input
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendText(); }
            }}
            placeholder="케이에게 말해봐..."
            disabled={textDisabled}
            className="flex-1 px-4 py-3 rounded-2xl text-sm outline-none border-2 border-transparent disabled:opacity-40"
            style={{ background: "white", fontFamily: "var(--font-base)", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}
            maxLength={200}
          />
          <button
            onClick={handleSendText}
            disabled={textDisabled || !textInput.trim()}
            className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 disabled:opacity-30 active:scale-95 transition-transform"
            style={{ background: "var(--color-primary)", color: "white" }}
            aria-label="전송"
          >
            <IconSend />
          </button>
        </div>
      </div>
    </div>
  );

  // ── 단일 반환 — PC shell 래퍼 ────────────────────────────
  const shellBg = mode === "voice" ? "var(--color-child-bg)" : "var(--color-parent-bg)";

  return (
    <div className="chat-page-root">
      <div className="chat-page-shell" style={{ background: shellBg }}>
        {mode === "voice" ? voiceContent : textContent}
      </div>

      {/* 펄스 링 애니메이션 스타일 태그 */}
      <style>{`
        @keyframes ripple {
          0% {
            transform: scale(1);
            opacity: 0.8;
          }
          100% {
            transform: scale(1.6);
            opacity: 0;
          }
        }
        .animate-ripple {
          animation: ripple 2s infinite ease-out;
        }
        .animate-ripple-delay {
          animation: ripple 2s infinite ease-out;
          animation-delay: 1s;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fade-in {
          animation: fadeIn 0.2s ease-out;
        }
      `}</style>

      {/* 종료 확인 팝업 모달 */}
      {showExitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-3xl p-6 shadow-2xl w-80 text-center max-w-full">
            <h3 className="text-base font-bold text-gray-800 mb-2">대화를 끝낼까요?</h3>
            <p className="text-xs text-gray-500 mb-6">지금 대화를 끝내면 오늘의 대화 분석 리포트가 생성됩니다.</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setShowExitModal(false)}
                className="flex-1 py-2.5 rounded-xl font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors text-sm"
              >
                취소
              </button>
              <button
                onClick={() => {
                  setShowExitModal(false);
                  stopSession();
                }}
                className="flex-1 py-2.5 rounded-xl font-semibold text-white bg-orange-500 hover:bg-orange-600 transition-colors text-sm shadow-md"
              >
                끝내기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
