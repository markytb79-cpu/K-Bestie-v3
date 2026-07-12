"use client";

import { useRef, useState, useCallback, useEffect } from "react";

// Gemini Live 네이티브 오디오 API를 폐기하고 STT(근사 스트리밍) + 텍스트 LLM + TTS 분리 구조로 전환.
// 구성: 아이 음성 → GCP STT(/api/mission/stt, recognize REST 주기호출) → 텍스트
//      → (필요 시) Gemini 2.5 Flash 텍스트(/api/voice/respond) → 케이 응답 텍스트
//      → GCP TTS(/api/voice/tts, Wavenet) → 음성 재생
// 자막은 STT/LLM이 돌려주는 텍스트를 그대로 표시하므로 Live transcription 이벤트 문제가 없다.

export type SessionStatus = "idle" | "connecting" | "live" | "ended" | "error";
export interface Turn { role: "child" | "k"; text: string }

export interface UseVoiceChatOptions {
  /** 한 턴이 완전히 끝날 때마다 호출 (child: 발화 확정 시, k: 말하기 시작 시) */
  onTurnComplete?: (turn: Turn) => void;
  /** 현재 chat_sessions.id를 반환. respondText()가 안전 이벤트 저장을 위해 /api/voice/respond에 함께 전송한다. */
  getSessionId?: () => string | null;
}

const POLL_INTERVAL_MS = 1300;       // 중간 자막 갱신 주기
const SILENCE_MS_TO_FINALIZE = 900;  // 이만큼 조용하면 발화 종료로 판단
const RMS_SILENCE_THRESHOLD = 0.012; // 이 이하 진폭은 무음으로 간주
const CHUNK_MS = 128;                // processor 콜백 1회당 대략적 시간(16kHz, 2048 샘플)

function encodePCM16Base64(chunks: Uint8Array[]): string {
  let total = 0;
  for (const c of chunks) total += c.length;
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.length; }
  let binary = "";
  for (let i = 0; i < merged.length; i++) binary += String.fromCharCode(merged[i]);
  return btoa(binary);
}

export function useVoiceChat(options?: UseVoiceChatOptions) {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [interimChildText, setInterimChildText] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);

  const statusRef = useRef<SessionStatus>("idle");
  const transcriptRef = useRef<Turn[]>([]);
  const onTurnCompleteRef = useRef<((turn: Turn) => void) | undefined>(undefined);
  onTurnCompleteRef.current = options?.onTurnComplete;

  const micStreamRef = useRef<MediaStream | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const micEnabledRef = useRef(true);
  const speakingRef = useRef(false);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const chunksRef = useRef<Uint8Array[]>([]);
  const hasSpeechRef = useRef(false);
  const silenceMsRef = useRef(0);
  const sttBusyRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 발화(utterance) 세대 카운터 — finalize 시점마다 증가.
  // 이미 확정(final)된 뒤에 뒤늦게 도착하는 중간(interim) 응답이 확정 말풍선과
  // 동일 내용으로 다시 표시되는 중복 버그 방지용(경합 시 이전 세대 응답은 폐기).
  const utteranceEpochRef = useRef(0);
  // speak() 세대 카운터 — 케이 발화(TTS) 호출마다 증가.
  // 새 speak() 호출은 이전 재생 중인 오디오를 즉시 중단시키고, 이전 호출의 응답/재생은
  // 전부 폐기한다(single-audio 보장, 말풍선·음성 중복 표시 방지).
  const speakEpochRef = useRef(0);

  function updateStatus(s: SessionStatus) {
    statusRef.current = s;
    setStatus(s);
  }

  function appendTurn(turn: Turn) {
    transcriptRef.current = [...transcriptRef.current, turn];
    setTranscript([...transcriptRef.current]);
  }

  async function callStt(audioBase64: string): Promise<string> {
    try {
      const res = await fetch("/api/mission/stt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64 }),
      });
      if (!res.ok) return "";
      const data = await res.json();
      return typeof data.transcript === "string" ? data.transcript.trim() : "";
    } catch {
      return "";
    }
  }

  const finalizeChildTurn = useCallback(async () => {
    const epoch = ++utteranceEpochRef.current; // 새 세대로 전환 — 이전 세대의 낡은 interim 응답은 이후 전부 무시됨
    const chunks = chunksRef.current;
    chunksRef.current = [];
    hasSpeechRef.current = false;
    silenceMsRef.current = 0;
    setInterimChildText("");
    if (chunks.length === 0) return;

    const audioBase64 = encodePCM16Base64(chunks);
    const text = await callStt(audioBase64);
    if (!text) return;
    if (epoch !== utteranceEpochRef.current) return; // 그 사이 다음 발화가 이미 시작/확정됐으면 중복 방지를 위해 폐기

    appendTurn({ role: "child", text });
    onTurnCompleteRef.current?.({ role: "child", text });
  }, []);

  const startSession = useCallback(async () => {
    if (statusRef.current === "live" || statusRef.current === "connecting") return;
    setError(null);
    updateStatus("connecting");
    transcriptRef.current = [];
    setTranscript([]);
    chunksRef.current = [];
    hasSpeechRef.current = false;
    silenceMsRef.current = 0;
    setInterimChildText("");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("마이크를 사용하려면 HTTPS로 접속하세요.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      micStreamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      inputCtxRef.current = inputCtx;
      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (ev) => {
        if (statusRef.current !== "live" || !micEnabledRef.current || speakingRef.current) return;
        const float32 = ev.inputBuffer.getChannelData(0);

        // RMS 기반 무음 감지
        let sumSq = 0;
        for (let i = 0; i < float32.length; i++) sumSq += float32[i] * float32[i];
        const rms = Math.sqrt(sumSq / float32.length);

        const buf = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          buf[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
        }
        chunksRef.current.push(new Uint8Array(buf.buffer.slice(0)));

        if (rms >= RMS_SILENCE_THRESHOLD) {
          hasSpeechRef.current = true;
          silenceMsRef.current = 0;
        } else {
          silenceMsRef.current += CHUNK_MS;
          if (hasSpeechRef.current && silenceMsRef.current >= SILENCE_MS_TO_FINALIZE) {
            void finalizeChildTurn();
          }
        }
      };
      source.connect(processor);
      processor.connect(inputCtx.destination);

      // 중간 자막 갱신 — 말하는 도중 누적된 오디오를 주기적으로 재인식(반투명 임시 표시 전용,
      // transcript에는 절대 append하지 않음 — 확정 저장은 finalizeChildTurn에서만 1회 수행)
      pollTimerRef.current = setInterval(() => {
        if (sttBusyRef.current) return;
        if (!hasSpeechRef.current || chunksRef.current.length === 0) return;
        sttBusyRef.current = true;
        const epoch = utteranceEpochRef.current;
        const audioBase64 = encodePCM16Base64(chunksRef.current);
        void callStt(audioBase64).then((text) => {
          sttBusyRef.current = false;
          // 이미 finalize되어 다음 세대로 넘어간 뒤 도착한 낡은 응답이면 폐기(중복 표시 방지)
          if (epoch !== utteranceEpochRef.current) return;
          if (text) setInterimChildText(text);
        });
      }, POLL_INTERVAL_MS);

      updateStatus("live");
    } catch (err) {
      console.error("[VoiceChat] startSession error:", err);
      setError((err as Error).message);
      updateStatus("error");
    }
  }, [finalizeChildTurn]);

  function teardown() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    processorRef.current?.disconnect();
    processorRef.current = null;
    inputCtxRef.current?.close().catch(() => {});
    inputCtxRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current = null;
    }
    chunksRef.current = [];
    hasSpeechRef.current = false;
    silenceMsRef.current = 0;
    speakingRef.current = false;
    setIsSpeaking(false);
    setInterimChildText("");
  }

  const stopSession = useCallback(() => {
    teardown();
    updateStatus("ended");
  }, []);

  const reset = useCallback(() => {
    teardown();
    transcriptRef.current = [];
    setTranscript([]);
    setError(null);
    updateStatus("idle");
  }, []);

  const getTranscript = useCallback(() => transcriptRef.current, []);

  const setMicEnabled = useCallback((enabled: boolean) => {
    micEnabledRef.current = enabled;
  }, []);

  /** 케이 발화 재생 — TTS 합성 후 오디오 재생. 재생 중엔 마이크 캡처를 잠시 멈춘다(에코 방지).
   *  새 호출 시 이전 재생 중인 오디오를 즉시 중단하고, 이전 호출의 응답/재생은 전부 폐기해서
   *  절대 두 음성이 동시에 겹치거나 말풍선이 중복 표시되지 않도록 보장한다(single-audio). */
  // ⚠️ voiceName은 임시 목소리 비교 테스트용 파라미터(미확정, 나중에 제거 예정).
  // 넘기지 않으면 /api/voice/tts의 기본 보이스가 그대로 적용됨(기존 동작 불변).
  // 반환값(boolean)은 TTS 합성이 실제로 성공했는지 여부 — 임시 목소리 테스트 UI가
  // 실패한 보이스를 감지해 안내하는 용도로만 쓰인다(기존 호출부는 반환값 무시해도 무방).
  const speak = useCallback(async (text: string, voiceName?: string): Promise<boolean> => {
    const trimmed = text.trim();
    console.log("[MISSION-DEBUG] speak() invoked, text:", trimmed, "voiceName:", voiceName);
    if (!trimmed) return false;

    // 새 발화 세대로 전환 — 이전 세대의 진행 중이던 응답/재생은 이후 전부 무시됨
    const epoch = ++speakEpochRef.current;

    // 이전에 재생 중이던 오디오가 있으면 즉시 중단(겹침 방지)
    if (audioElRef.current) {
      try {
        audioElRef.current.pause();
        audioElRef.current.currentTime = 0;
      } catch { /* 이미 정지된 경우 무시 */ }
      audioElRef.current = null;
    }

    speakingRef.current = true;
    setIsSpeaking(true);
    let spoken = false;
    let ttsOk = false; // TTS 합성 자체가 성공했는지(목소리 테스트 성공/실패 판정용)

    try {
      const res = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(voiceName ? { text: trimmed, voiceName } : { text: trimmed }),
      });
      console.log("[MISSION-DEBUG] /api/voice/tts status:", res.status);
      if (epoch !== speakEpochRef.current) { console.log("[MISSION-DEBUG] speak() epoch superseded, discarding tts response"); return false; }
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.error("[MISSION-DEBUG] tts !res.ok, voice:", voiceName, "body:", errBody);
        throw new Error("TTS response not ok");
      }
      const data = await res.json();
      if (epoch !== speakEpochRef.current) return false;
      if (!data.audioContent) {
        console.error("[MISSION-DEBUG] tts response missing audioContent:", data);
        throw new Error("TTS audioContent missing");
      }
      ttsOk = true;

      const audio = new Audio(`data:${data.mimeType ?? "audio/mp3"};base64,${data.audioContent}`);
      if (epoch !== speakEpochRef.current) return false; // 오디오 객체 생성 사이에 또 새 speak()가 호출된 경우 대비

      audioElRef.current = audio;

      // 음성 재생 개시 시점에 맞추어 자막 출력
      appendTurn({ role: "k", text: trimmed });
      onTurnCompleteRef.current?.({ role: "k", text: trimmed });
      spoken = true;

      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch((e) => { console.error("[MISSION-DEBUG] audio.play() rejected:", e); resolve(); });
      });
    } catch (err) {
      console.error("[MISSION-DEBUG] speak() caught exception:", err, "voice:", voiceName);
      // TTS가 실패하더라도 자막은 반드시 출력(단, 이 호출이 여전히 최신 세대일 때만)
      if (!spoken && epoch === speakEpochRef.current) {
        appendTurn({ role: "k", text: trimmed });
        onTurnCompleteRef.current?.({ role: "k", text: trimmed });
      }
    } finally {
      if (epoch === speakEpochRef.current) {
        speakingRef.current = false;
        setIsSpeaking(false);
        audioElRef.current = null;
      }
    }
    return ttsOk;
  }, []);

  /** 자유대화용 — 현재까지의 대화 기록으로 Gemini 텍스트 응답을 생성해 말풍선에만 표시.
   *  케이는 자유대화에서 음성으로 말하지 않는다 — TTS 호출 없음(텍스트 전용). */
  const respondText = useCallback(async () => {
    try {
      const res = await fetch("/api/voice/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          history: transcriptRef.current,
          sessionId: options?.getSessionId?.() ?? null,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const text = typeof data.text === "string" ? data.text.trim() : "";
      if (!text) return;
      appendTurn({ role: "k", text });
      onTurnCompleteRef.current?.({ role: "k", text });
    } catch {
      // 무응답 시 침묵 — 재시도는 다음 아이 발화에서
    }
  }, []);

  /** 텍스트 입력(💬 모드) — 아이 발화로 즉시 처리 */
  const sendTypedText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    appendTurn({ role: "child", text: trimmed });
    onTurnCompleteRef.current?.({ role: "child", text: trimmed });
  }, []);

  /** 케이가 정해진 문구를 텍스트로만 표시(TTS 없음) — 자유대화 하드리밋 안내 등에 사용 */
  const sayText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    appendTurn({ role: "k", text: trimmed });
    onTurnCompleteRef.current?.({ role: "k", text: trimmed });
  }, []);

  useEffect(() => {
    return () => teardown();
  }, []);

  return {
    status, error, transcript, interimChildText, isSpeaking,
    startSession, stopSession, reset, getTranscript,
    speak, respondText, sendTypedText, sayText, setMicEnabled,
  };
}
