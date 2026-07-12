"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealChildNav } from "@/components/RealChildNav";
import { useVoiceChat, type Turn } from "@/hooks/useVoiceChat";
import { useGeminiLive } from "@/hooks/useGeminiLive";

type RoundType = "round1_day" | "round2_night" | "common";
type VoiceMode = "stt_tts" | "live";

interface MissionQuestion {
  id: string;
  question_text: string;
  dashboard_area_tag: string;
  cycle_type: string;
  round_type: RoundType;
}

type QuestionState = "pending" | "answered" | "skipped" | "refused";

const REQUIRED_COUNT = 5;

// 🔧 임시 테스트용 — Live API(Gemini 3.1 flash live preview) 지원 보이스 전체 목록.
// TODO: Live 목소리 확정 후 이 테스트 드롭다운(및 이 목록) 제거.
const LIVE_TEST_VOICES: { name: string; label?: string }[] = [
  { name: "Zephyr", label: "Bright" },
  { name: "Puck", label: "Upbeat" },
  { name: "Charon", label: "Informative" },
  { name: "Kore", label: "Firm" },
  { name: "Fenrir", label: "Excitable" },
  { name: "Leda", label: "Youthful" },
  { name: "Orus", label: "Firm" },
  { name: "Aoede", label: "Breezy" },
  { name: "Callirrhoe", label: "Easy-going" },
  { name: "Autonoe", label: "Bright" },
  { name: "Enceladus", label: "Breathy" },
  { name: "Iapetus", label: "Clear" },
  { name: "Umbriel", label: "Easy-going" },
  { name: "Algieba", label: "Smooth" },
  { name: "Despina", label: "Smooth" },
  { name: "Erinome", label: "Clear" },
  { name: "Algenib", label: "Gravelly" },
  { name: "Rasalgethi", label: "Informative" },
  { name: "Laomedeia", label: "Upbeat" },
  { name: "Achernar", label: "Soft" },
  { name: "Alnilam", label: "Firm" },
  { name: "Schedar", label: "Even" },
  { name: "Gacrux", label: "Mature" },
  { name: "Pulcherrima", label: "Forward" },
  { name: "Achird", label: "Friendly" },
  { name: "Zubenelgenubi", label: "Casual" },
  { name: "Vindemiatrix", label: "Gentle" },
  { name: "Sadachbia", label: "Lively" },
  { name: "Sadaltager", label: "Knowledgeable" },
  { name: "Sulafat", label: "Warm" },
];

// ⚠️⚠️⚠️ 임시 테스트용 우회 (TEMP TEST BYPASS) ⚠️⚠️⚠️
// 운영시간 게이트를 항상 통과시켜 시간과 무관하게 미션 테스트 가능하게 함.
// 되돌리려면(=원래 운영시간 제한 복원) 아래 값을 false로 바꾸면 됨.
// 게이트 로직(getKstHour/currentRound) 자체는 삭제하지 않고 그대로 둠 — 우회는 사용 지점에서만 적용.
const BYPASS_MISSION_TIME_GATE_FOR_TESTING = true;

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
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [textInput, setTextInput] = useState("");
  // 요금제(tier)별 음성 방식 — /api/mission/start 응답으로 확정됨. 확정 전까지 null(로딩).
  const [voiceMode, setVoiceMode] = useState<VoiceMode | null>(null);
  // 🔧 임시 테스트용 — Tier3(Live) 전용 목소리 선택. TODO: Live 목소리 확정 후 제거.
  const [testVoiceName, setTestVoiceName] = useState<string>("Aoede");
  // 🔧 임시 테스트용 — Live는 목소리를 먼저 고르고 "시작" 버튼을 눌러야 세션이 연결되게 함
  // (불필요한 Live API 연결/비용 방지). stt_tts(Tier1/2)는 이 게이트와 무관하게 기존처럼 자동 시작.
  // TODO: Live 목소리 확정 후 이 게이트와 관련 UI 제거(자동 시작으로 복원).
  const [liveReadyToStart, setLiveReadyToStart] = useState(false);

  const sessionIdRef = useRef<string | null>(null);
  const questionsRef = useRef<MissionQuestion[]>([]);
  const currentIndexRef = useRef(0);
  const questionStatesRef = useRef<Record<string, QuestionState>>({});
  const askedIndexRef = useRef<number>(-1);
  const completedRef = useRef(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  // askQuestion은 훅 생성 이후에만 얻을 수 있어 ref로 우회
  // (handleTurnComplete는 훅 생성 전에 정의되어야 하므로 직접 참조 불가)
  const askQuestionRef = useRef<((idx: number, customText?: string) => void) | undefined>(undefined);
  const getTranscriptRef = useRef<(() => Turn[]) | undefined>(undefined);
  // 🔧 임시 테스트용 — handleTurnComplete(useCallback, deps 고정)에서 최신 isLiveMode를
  // 참조하기 위한 ref. TODO: Live 목소리 확정 후 이 ref와 관련 예외 분기 제거.
  const isLiveModeRef = useRef(false);

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

        // 🔧 임시 테스트용 — Live 목소리 테스트 중엔 진행도(%) 증가와 미션 완료 처리를 멈춰서,
        // 목소리를 끝까지 들어보기 전에 미션이 끝나버리지 않게 함.
        // TODO: Live 목소리 확정 후 이 예외(if/else 전체) 제거하고 항상 정상 처리되게 되돌릴 것.
        if (!isLiveModeRef.current) {
          setGauge(data.validAnswerCount ?? 0);

          if (data.completed) {
            completedRef.current = true;
            setCompleted(true);
            return;
          }
        }

        const next = pickNextIndex(questionStatesRef.current);
        if (next === -1) return;

        currentIndexRef.current = next;

        // 다음 질문 유도 멘트 동적 생성 및 폴백
        const nextQ = questionsRef.current[next];
        if (nextQ) {
          try {
            const respondRes = await fetch("/api/mission/respond", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                history: getTranscriptRef.current?.() ?? [],
                nextQuestionText: nextQ.question_text,
              }),
            });
            if (respondRes.ok) {
              const respondData = await respondRes.json();
              if (respondData.text) {
                askQuestionRef.current?.(next, respondData.text);
                return;
              }
            }
          } catch {
            // 실패 시 아래 순정 질문 텍스트로 폴백
          }
          askQuestionRef.current?.(next);
        }
      } catch {
        // 에러 시 재시도
      }
    })();
  }, [saveMessage, pickNextIndex]);

  // 두 음성 백엔드를 항상 함께 마운트해두고(리액트 훅 규칙상 조건부 호출 불가),
  // voiceMode(tier)에 따라 실제로 사용하는 쪽만 startSession되도록 분기한다.
  // - stt_tts (Tier1/2): GCP STT(주기호출) + Wavenet-A TTS
  // - live (Tier3): Gemini Live API 네이티브 오디오(gemini-3.1-flash-live-preview)
  const sttTts = useVoiceChat({ onTurnComplete: handleTurnComplete });
  const live = useGeminiLive({ onTurnComplete: handleTurnComplete, voiceName: testVoiceName });

  const isLiveMode = voiceMode === "live";
  isLiveModeRef.current = isLiveMode;

  const voice = isLiveMode
    ? {
        status: live.status as string,
        transcript: live.transcript,
        interimChildText: live.interimChildText,
        startSession: live.startSession,
        stopSession: live.stopSession,
        setMicEnabled: live.setMicEnabled,
        sendTypedText: live.sendText,
        getTranscript: live.getTranscript,
      }
    : {
        status: sttTts.status as string,
        transcript: sttTts.transcript,
        interimChildText: sttTts.interimChildText,
        startSession: sttTts.startSession,
        stopSession: sttTts.stopSession,
        setMicEnabled: sttTts.setMicEnabled,
        sendTypedText: sttTts.sendTypedText,
        getTranscript: sttTts.getTranscript,
      };

  getTranscriptRef.current = voice.getTranscript;

  const askQuestion = useCallback((idx: number, customText?: string) => {
    const q = questionsRef.current[idx];
    if (!q) return;
    askedIndexRef.current = idx;
    const textToSpeak = customText || q.question_text;
    if (isLiveMode) {
      live.speakAsK(textToSpeak);
    } else {
      void sttTts.speak(textToSpeak); // voiceName 생략 — 서버 기본값(ko-KR-Wavenet-A) 사용
    }
  }, [isLiveMode, live, sttTts]);
  askQuestionRef.current = askQuestion;

  // 🔧 임시 테스트용 — Live 목소리 변경 시 즉시 반영을 위해 세션 재연결.
  // Live API는 연결 시점(speechConfig)에 보이스가 확정되므로 변경만으로는 반영되지 않는다.
  // TODO: Live 목소리 확정 후 이 핸들러 및 관련 UI 제거.
  const handleTestVoiceChange = useCallback((name: string) => {
    setTestVoiceName(name);
    if (!isLiveMode) return;
    live.stopSession();
    // stopSession()의 teardown이 동기적으로 끝나므로 다음 tick에 재연결(voiceNameRef는 이미 최신값 반영됨)
    setTimeout(() => {
      live.startSession({ preserveHistory: true });
    }, 0);
  }, [isLiveMode, live]);

  const switchToText = useCallback(() => {
    setMode("text");
    voice.setMicEnabled(false);
  }, [voice]);

  const switchToVoice = useCallback(() => {
    setMode("voice");
    voice.setMicEnabled(true);
  }, [voice]);

  const handleSendText = useCallback(() => {
    const text = textInput.trim();
    if (!text) return;
    setTextInput("");
    voice.sendTypedText(text);
  }, [textInput, voice]);

  const handleClose = useCallback(() => {
    voice.stopSession();
    router.replace("/child/home");
  }, [voice, router]);

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
    // ⚠️ TEMP TEST BYPASS: BYPASS_MISSION_TIME_GATE_FOR_TESTING가 true면 게이트 결과가 null이어도
    // "common" 라운드로 대체해 항상 통과시킴. 원복하려면 파일 상단 플래그를 false로.
    const round: RoundType | null =
      qpRound ?? currentRound(hour) ?? (BYPASS_MISSION_TIME_GATE_FOR_TESTING ? "common" : null);
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
        if (qs.length > 0) {
          qs[0].question_text = "안녕~ 난 케이야. 넌 이름이 뭐니?";
        }
        setQuestions(qs);
        questionsRef.current = qs;
        const initStates: Record<string, QuestionState> = {};
        for (const q of qs) initStates[q.id] = "pending";
        questionStatesRef.current = initStates;
        setVoiceMode((data.voiceMode as VoiceMode) ?? "stt_tts");
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
    if (phase !== "ready" || !voiceMode || voice.status !== "idle") return;
    // 🔧 임시 테스트용 — Live는 목소리를 고르고 "시작" 버튼을 누르기 전엔 연결하지 않는다
    // (불필요한 Live API 연결/비용 방지). TODO: Live 목소리 확정 후 이 조건 제거.
    if (voiceMode === "live" && !liveReadyToStart) return;
    voice.startSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, voiceMode, voice.status, liveReadyToStart]);

  // 세션 시작 후 최초 1회만 첫 질문을 묻는다. 이후 질문은 handleTurnComplete에서
  // 답변 처리 완료 시점에 askQuestionRef를 통해 직접 트리거된다(ref 변화는 effect를
  // 재실행시키지 않으므로, "다음 질문"을 이 effect가 알아채길 기다리면 안 됨).
  useEffect(() => {
    if (voice.status !== "live" || completed) return;
    if (askedIndexRef.current !== -1) return;
    askQuestion(currentIndexRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.status, completed, askQuestion]);

  useEffect(() => {
    if (completed) voice.stopSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed]);

  useEffect(() => {
    bubbleRef.current?.scrollTo({ top: bubbleRef.current.scrollHeight, behavior: "smooth" });
  }, [voice.transcript, voice.interimChildText]);

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

  // 🔧 임시 테스트용 — Live는 목소리를 먼저 고르고 "시작"을 눌러야 세션이 연결됨.
  // TODO: Live 목소리 확정 후 이 화면과 게이트 전체 제거(자동 시작으로 복원).
  if (isLiveMode && !liveReadyToStart) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 p-6 text-center" style={{ background: "#fafaf8" }}>
        <p className="text-5xl">🔊</p>
        <p className="text-base font-bold text-gray-800">케이 목소리를 먼저 골라보세요</p>
        <p className="text-xs text-gray-500">🔧 Live 목소리 테스트(임시)</p>
        <select
          value={testVoiceName}
          onChange={(e) => setTestVoiceName(e.target.value)}
          className="text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white cursor-pointer"
        >
          {LIVE_TEST_VOICES.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name}{v.label ? ` (${v.label})` : ""}
            </option>
          ))}
        </select>
        <button
          onClick={() => setLiveReadyToStart(true)}
          className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform cursor-pointer"
          style={{ background: "#1a6b5a" }}
        >
          이 목소리로 시작하기
        </button>
      </div>
    );
  }

  const isConnecting = voice.status === "connecting";
  const isLive = voice.status === "live";
  const isDone = completed || gauge >= REQUIRED_COUNT;
  const missionPercent = Math.min(gauge * 20, 100);

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "#fafaf8" }}>
      {/* 상단 고정 영역: 헤더 + 진행률 게이지 + 마스코트 (스크롤되지 않음) */}
      <div className="shrink-0 sticky top-0 z-10" style={{ background: "#fafaf8" }}>
        <div className="flex items-center justify-center px-4 pt-4 pb-2">
          <Link href="/child/home" className="cursor-pointer">
            <Image
              src="/Images/logo/Logo.png"
              alt="내친구 케이"
              width={84}
              height={24}
              className="object-contain"
              priority
            />
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

        {/* 🔧 임시 테스트용 — Tier3(Live) 화면에서만 노출. TODO: Live 목소리 확정 후 제거. */}
        {isLiveMode && (
          <div className="px-6 pb-2 flex items-center justify-center gap-2">
            <label className="text-[11px] text-gray-400" htmlFor="live-test-voice">
              🔧 Live 목소리 테스트(임시)
            </label>
            <select
              id="live-test-voice"
              value={testVoiceName}
              onChange={(e) => handleTestVoiceChange(e.target.value)}
              className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 bg-white cursor-pointer"
            >
              {LIVE_TEST_VOICES.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}{v.label ? ` (${v.label})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex justify-center mb-4">
          <Image
            src="/Images/mascot/mascot-standing.png"
            alt="케이 마스코트"
            width={96}
            height={96}
            className="object-contain"
            priority
          />
        </div>
      </div>

      {/* 대화 말풍선: 이 영역만 스크롤 */}
      <div
        ref={bubbleRef}
        className="flex-1 min-h-0 px-4 flex flex-col gap-3 overflow-y-auto pb-4"
      >
        {voice.transcript.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center p-4">
            <p className="text-xs" style={{ color: "#9ca3af" }}>
              곧 케이가 첫 질문을 해줄 거예요 🌿
            </p>
          </div>
        ) : (
          voice.transcript.map((turn, i) => (
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
        {/* 아이가 말하는 도중의 실시간 중간 자막 — 확정 전이라 옅게 표시 */}
        {voice.interimChildText && (
          <div
            className="max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed self-end opacity-60"
            style={{
              background: "#3b82f6",
              color: "#ffffff",
              borderRadius: "16px 16px 2px 16px",
            }}
          >
            {voice.interimChildText}
          </div>
        )}
      </div>

      {/* 하단 버튼 바 */}
      {mode === "voice" ? (
        <div className="flex items-center justify-center gap-8 py-5 shrink-0 bg-white border-t border-gray-50">
          <button
            onClick={switchToText}
            className="w-11 h-11 rounded-full flex items-center justify-center bg-white shadow-sm text-lg cursor-pointer"
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
                onClick={() => voice.stopSession()}
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
              onClick={() => voice.startSession()}
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
            onClick={handleClose}
            className="w-11 h-11 rounded-full flex items-center justify-center bg-white shadow-sm text-lg cursor-pointer"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 py-3 px-3 shrink-0 bg-white border-t border-gray-50">
          <button
            onClick={switchToVoice}
            className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center bg-white shadow-sm text-lg cursor-pointer"
            aria-label="음성으로 전환"
          >
            🎤
          </button>
          <input
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendText(); }
            }}
            placeholder="케이에게 답해봐..."
            disabled={isDone}
            className="flex-1 px-4 py-3 rounded-2xl text-sm outline-none border border-gray-200 disabled:opacity-50"
            maxLength={200}
          />
          <button
            onClick={handleSendText}
            disabled={isDone || !textInput.trim()}
            className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-white disabled:opacity-40 cursor-pointer"
            style={{ background: "#e8845a" }}
            aria-label="전송"
          >
            ➤
          </button>
          <button
            onClick={handleClose}
            className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center bg-white shadow-sm text-lg cursor-pointer"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
      )}

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
