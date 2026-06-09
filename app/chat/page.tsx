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
    startSession, pauseSession, getTranscript, reset,
    sendText, setAudioMuted, setMicEnabled,
  } = useGeminiLive({ onTurnComplete: handleTurnComplete });

  const status = mounted ? rawStatus : "idle";
  const supabase = createClient();

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

  const handleStart = useCallback(async () => {
    if (!childId) return;
    setReportDone(false);
    setReportError(null);

    if (status === "paused" && sessionIdRef.current) {
      await startSession({ preserveHistory: true });
      return;
    }


    const { data } = await supabase
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
  }, [childId, startSession, status, supabase]);

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
      {Header}

      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
        {/* 왼쪽 컨트롤 영역 */}
        <div className="flex flex-col items-center justify-between p-6 shrink-0 md:w-[320px] md:border-r border-[#1A6B5A]/10 bg-white/40">
          <div className="flex flex-col items-center justify-center flex-1 w-full pb-4">
            <div className="relative mb-4 shrink-0">
              {isActive && (
                <span
                  className="absolute inset-0 rounded-full animate-ping opacity-25"
                  style={{ background: "var(--color-accent)" }}
                />
              )}
              <Image
                src="/character_logo.png"
                alt="케이"
                width={76} height={76}
                className="relative object-contain"
                style={{
                  filter: isLive
                    ? "drop-shadow(0 0 12px var(--color-accent))"
                    : isConnecting ? "brightness(0.85)" : "none",
                }}
                priority
              />
            </div>

            {/* 타이핑 애니메이션 OR 자막 텍스트 */}
            {isLive && !latestK ? (
              <div className="k-typing">
                <span /><span /><span />
              </div>
            ) : (
              <p
                className="text-center font-bold leading-snug px-2 text-gray-800"
                style={{
                  fontSize: isLive && latestK ? "1.1rem" : "0.875rem",
                  color: isLive && latestK
                    ? "var(--color-primary)"
                    : "var(--color-text-muted)",
                  minHeight: "3.6em",
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {captionText}
              </p>
            )}
          </div>

          {/* 마이크 컨트롤 */}
          <div className="flex flex-col items-center gap-2.5 w-full pb-2 md:pb-4 shrink-0">
            <button
              onClick={isLive ? handlePause : (isIdle || isPaused) ? handleStart : undefined}
              disabled={micDisabled}
              aria-label={isLive ? "대화 일시정지" : isPaused ? "대화 재개" : "대화 시작"}
              className="relative w-[76px] h-[76px] rounded-full flex items-center justify-center transition-transform active:scale-95 disabled:opacity-40"
              style={{
                background: isLive ? "var(--color-primary)" : "var(--color-accent)",
                boxShadow: isActive
                  ? "0 0 0 10px rgba(218,119,73,0.18), 0 4px 20px rgba(218,119,73,0.4)"
                  : "0 4px 20px rgba(218,119,73,0.35)",
              }}
            >
              {isActive && (
                <span className="absolute inset-0 rounded-full animate-ping opacity-20"
                  style={{ background: "var(--color-accent)" }} />
              )}
              {isLive ? <IconStop /> : <IconMic />}
            </button>
            <p className="text-xs font-semibold text-center mt-1" style={{ color: "var(--color-primary)" }}>
              {isIdle && "마이크를 눌러서 말해봐!"}
              {isConnecting && "연결하는 중..."}
              {isLive && "탭해서 일시정지"}
              {isPaused && "눌러서 계속 말해봐!"}
              {(isEnded || isError) && " "}
            </p>
            <div className="mt-2.5">{ModeToggleFAB}</div>
          </div>
        </div>

        {/* 오른쪽 말풍선 영역 */}
        <div
          ref={voiceBubbleRef}
          className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2 bg-white/20"
          style={{ borderTop: "1px solid rgba(0,0,0,0.04)" }}
        >
          {transcript.length === 0 ? (
            <div className="flex items-center justify-center h-full text-center">
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                {isIdle ? "마이크를 눌러 대화를 시작해봐!" : "곧 대화 내역이 여기에 표시돼요"}
              </p>
            </div>
          ) : (
            transcript.map((turn, i) => (
              <BubbleItem key={i} turn={turn} showSpeaker={false} />
            ))
          )}
          {EndedNotice}
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
    </div>
  );
}
