"use client";

import { useRef, useState, useCallback } from "react";
import { GoogleGenAI, Modality, type LiveServerMessage } from "@google/genai";

export type SessionStatus = "idle" | "connecting" | "live" | "ending" | "ended" | "paused" | "error";
export interface Turn { role: "child" | "k"; text: string }

export interface UseGeminiLiveOptions {
  /** 한 턴이 완전히 끝날 때마다 호출.
   *  - child: 음성 인식 완료 or sendText 호출 직후
   *  - k: Gemini turnComplete 이벤트 수신 시 (스트리밍 전체 텍스트)
   */
  onTurnComplete?: (turn: Turn) => void;
}

// ── PCM 인코딩/디코딩 ────────────────────────────────────────
function encodePCM16(float32: Float32Array): string {
  const buf = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    buf[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
  }
  let binary = "";
  const bytes = new Uint8Array(buf.buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decodePCM16(base64: string, sampleRate: number): AudioBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  // 오프라인 컨텍스트로 디코딩 — 재생 컨텍스트 공유 없이 버퍼만 생성
  const offlineCtx = new OfflineAudioContext(1, int16.length, sampleRate);
  const buf = offlineCtx.createBuffer(1, int16.length, sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < int16.length; i++) ch[i] = int16[i] / 32768;
  return buf;
}

export function useGeminiLive(options?: UseGeminiLiveOptions) {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Turn[]>([]);

  const statusRef     = useRef<SessionStatus>("idle");
  const transcriptRef = useRef<Turn[]>([]);
  const sessionRef    = useRef<Awaited<ReturnType<InstanceType<typeof GoogleGenAI>["live"]["connect"]>> | null>(null);
  const micStreamRef  = useRef<MediaStream | null>(null);
  const processorRef  = useRef<ScriptProcessorNode | null>(null);
  const inputCtxRef   = useRef<AudioContext | null>(null);
  const outputCtxRef  = useRef<AudioContext | null>(null);
  const audioMutedRef = useRef(false);
  const micEnabledRef = useRef(true);

  // ── 스케줄 기반 오디오 재생 (갭 없는 gapless 재생) ─────────
  // 이전 큐/playNext 방식은 onended→start 사이 JS 이벤트 루프 갭으로 파직거림 발생.
  // AudioContext.currentTime 기반 startAt 스케줄링으로 버퍼 경계 클릭 제거.
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextScheduleTimeRef = useRef(0);

  // 콜백 ref — 렌더마다 최신 함수 유지
  const onTurnCompleteRef = useRef<((turn: Turn) => void) | undefined>(undefined);
  onTurnCompleteRef.current = options?.onTurnComplete;

  // 진단 카운터 — 첫 8개 서버 메시지의 serverContent 키를 콘솔에 출력
  const diagCountRef = useRef(0);

  function updateStatus(s: SessionStatus) {
    statusRef.current = s;
    setStatus(s);
  }

  function scheduleAudio(base64: string) {
    if (audioMutedRef.current) return;
    const ctx = outputCtxRef.current;
    if (!ctx) return;
    try {
      const audioBuffer = decodePCM16(base64, ctx.sampleRate);
      // 20ms lookahead — 버퍼가 도착하기 전 컨텍스트 시간을 지나치지 않도록
      const startAt = Math.max(ctx.currentTime + 0.02, nextScheduleTimeRef.current);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.start(startAt);
      nextScheduleTimeRef.current = startAt + audioBuffer.duration;
      scheduledSourcesRef.current.push(source);
      source.onended = () => {
        const arr = scheduledSourcesRef.current;
        const i = arr.indexOf(source);
        if (i !== -1) arr.splice(i, 1);
      };
    } catch { /* 손상된 프레임 무시 */ }
  }

  function stopAllScheduledSources() {
    scheduledSourcesRef.current.forEach(src => { try { src.stop(); } catch { /* already stopped */ } });
    scheduledSourcesRef.current = [];
    nextScheduleTimeRef.current = 0;
  }

  function appendTurn(turn: Turn) {
    const prev = transcriptRef.current;
    const last = prev[prev.length - 1];
    if (turn.role === "k" && last?.role === "k") {
      transcriptRef.current = [...prev.slice(0, -1), { role: "k", text: last.text + turn.text }];
    } else {
      transcriptRef.current = [...prev, turn];
    }
    setTranscript([...transcriptRef.current]);
  }

  function teardown() {
    stopAllScheduledSources();
    processorRef.current?.disconnect();
    processorRef.current = null;
    inputCtxRef.current?.close().catch(() => {});
    inputCtxRef.current = null;
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    outputCtxRef.current?.close().catch(() => {});
    outputCtxRef.current = null;
    const sess = sessionRef.current;
    sessionRef.current = null;
    try { sess?.close(); } catch { /* 이미 닫힌 경우 무시 */ }
  }

  const startSession = useCallback(async (opts?: { preserveHistory?: boolean }) => {
    if (statusRef.current === "live" || statusRef.current === "connecting") return;
    setError(null);
    updateStatus("connecting");
    if (!opts?.preserveHistory) {
      transcriptRef.current = [];
      setTranscript([]);
    }
    diagCountRef.current = 0;

    try {
      const res = await fetch("/api/voice/token", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Token fetch failed: ${res.status}`);
      }
      const { token, model } = await res.json();
      console.log("[K] 🔑 token received, model:", model);

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("마이크를 사용하려면 HTTPS로 접속하세요.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      micStreamRef.current = stream;
      console.log("[K] 🎙️ mic:", stream.getAudioTracks()[0]?.label);

      // 출력 AudioContext: Gemini는 24kHz PCM16을 보냄
      outputCtxRef.current = new AudioContext({ sampleRate: 24000 });
      nextScheduleTimeRef.current = 0;

      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });

      // K 턴 스트리밍 누적 — turnComplete 시 onTurnComplete 1회 호출
      let pendingKText = "";
      // 아이 발화 버퍼 — 첫 outputTranscription 도착 시 flush (#1429 workaround)
      let pendingChildText = "";

      // camelCase config — SDK가 직렬화, v1alpha에서 transcription 활성화
      // responseModalities는 AUDIO만 (TEXT 추가 시 1007로 끊김)
      const liveConfig = {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      };

      const session = await ai.live.connect({
        model,
        config: liveConfig,
        callbacks: {
          onopen: () => {
            console.log("[K] ✅ WebSocket open");
            updateStatus("live");
          },
          onmessage: (msg: LiveServerMessage) => {
            // ── 오디오 재생 ──────────────────────────────────────
            if (msg.data) scheduleAudio(msg.data);

            const sc = msg.serverContent as Record<string, unknown> | undefined;
            if (!sc) return;

            // ── 진단 로그 (첫 8개 serverContent 수신 시) ───────────
            if (diagCountRef.current < 8) {
              diagCountRef.current++;
              const keys = Object.keys(sc);
              console.log(`[K] 📨 sc#${diagCountRef.current} keys:`, keys);
              if (sc.outputTranscription) console.log("[K]   outputTranscription:", JSON.stringify(sc.outputTranscription));
              if (sc.inputTranscription)  console.log("[K]   inputTranscription:", JSON.stringify(sc.inputTranscription));
              const mt = sc.modelTurn as {parts?: unknown[]} | undefined;
              if (mt?.parts?.length) console.log("[K]   modelTurn.parts:", JSON.stringify(mt.parts).slice(0, 300));
            }

            // ── 아이 발화 → 버퍼 누적, 첫 outputTranscription 시 flush (#1429) ──
            const inTx = (sc.inputTranscription as {text?: string} | undefined)?.text;
            if (inTx) {
              console.log("[K] 📝 child (buf):", inTx);
              pendingChildText += inTx;
            }

            // ── 케이 응답 트랜스크립션 ────────────────────────────
            const outTx = (sc.outputTranscription as {text?: string} | undefined)?.text;
            if (outTx) {
              // K가 말을 시작하는 순간 아이 버퍼 flush
              if (pendingChildText) {
                console.log("[K] 📝 child (flush):", pendingChildText);
                appendTurn({ role: "child", text: pendingChildText });
                onTurnCompleteRef.current?.({ role: "child", text: pendingChildText });
                pendingChildText = "";
              }
              console.log("[K] 💬 k:", outTx);
              appendTurn({ role: "k", text: outTx });
              pendingKText += outTx;
            }

            // ── 턴 완료 ───────────────────────────────────────────
            if (sc.turnComplete) {
              if (pendingKText) {
                onTurnCompleteRef.current?.({ role: "k", text: pendingKText });
                pendingKText = "";
              }
            }
          },
          onerror: (e: ErrorEvent) => {
            console.error("[K] ❌ error:", e.message);
            setError(e.message ?? "WebSocket error");
            updateStatus("error");
            teardown();
          },
          onclose: (e: CloseEvent) => {
            console.log("[K] 🔌 closed — code:", e.code, e.reason || "");
            // 세션 종료 전 미완료 아이/K 턴 flush
            if (pendingChildText) {
              appendTurn({ role: "child", text: pendingChildText });
              onTurnCompleteRef.current?.({ role: "child", text: pendingChildText });
              pendingChildText = "";
            }
            if (pendingKText) {
              onTurnCompleteRef.current?.({ role: "k", text: pendingKText });
              pendingKText = "";
            }
            if (
              statusRef.current !== "ending" &&
              statusRef.current !== "ended" &&
              statusRef.current !== "paused"   // pauseSession()이 먼저 세팅한 경우 덮어쓰지 않음
            ) {
              updateStatus("ended");
            }
            teardown();
          },
        },
      });
      sessionRef.current = session;

      // ── PCM 캡처 → Gemini 전송 ───────────────────────────────
      // AudioContext sampleRate를 16000으로 강제 → 브라우저가 리샘플링 처리
      const inputCtx = new AudioContext({ sampleRate: 16000 });
      inputCtxRef.current = inputCtx;
      const source = inputCtx.createMediaStreamSource(stream);
      // bufferSize 2048: 16kHz에서 128ms — 지연 줄이면서 안정적인 청크 크기
      const processor = inputCtx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      let chunkCount = 0;
      processor.onaudioprocess = (ev) => {
        if (sessionRef.current && statusRef.current === "live" && micEnabledRef.current) {
          const float32 = ev.inputBuffer.getChannelData(0);
          const pcm = encodePCM16(float32);
          sessionRef.current.sendRealtimeInput({ audio: { data: pcm, mimeType: "audio/pcm;rate=16000" } });
          if (++chunkCount % 40 === 1) console.log(`[K] 📡 PCM #${chunkCount}`);
        }
      };
      source.connect(processor);
      processor.connect(inputCtx.destination);

    } catch (err) {
      console.error("[K] 🚨 startSession error:", err);
      setError((err as Error).message);
      updateStatus("error");
      teardown();
    }
  }, []);

  const stopSession = useCallback(() => {
    updateStatus("ending");
    teardown();
    updateStatus("ended");
  }, []);

  const pauseSession = useCallback(() => {
    // WebSocket·오디오만 끊음 — transcript/sessionId는 유지
    teardown();
    updateStatus("paused");
  }, []);

  const getTranscript = useCallback(() => transcriptRef.current, []);

  const reset = useCallback(() => {
    teardown();
    transcriptRef.current = [];
    setTranscript([]);
    setError(null);
    updateStatus("idle");
  }, []);

  /** 텍스트 모드 전환 시 오디오 자동재생 ON/OFF — mute 시 재생 중인 소스 즉시 중단 */
  const setAudioMuted = useCallback((muted: boolean) => {
    audioMutedRef.current = muted;
    if (muted) stopAllScheduledSources();
  }, []);

  /** 텍스트 모드 전환 시 PCM 전송 ON/OFF */
  const setMicEnabled = useCallback((enabled: boolean) => {
    micEnabledRef.current = enabled;
  }, []);

  /** 텍스트 메시지 전송 — child 턴으로 즉시 추가 후 onTurnComplete 호출 */
  const sendText = useCallback((text: string): boolean => {
    if (!sessionRef.current || statusRef.current !== "live") return false;
    appendTurn({ role: "child", text });
    onTurnCompleteRef.current?.({ role: "child", text });
    sessionRef.current.sendClientContent({
      turns: [{ role: "user", parts: [{ text }] }],
      turnComplete: true,
    });
    return true;
  }, []);

  return {
    status, error, transcript,
    startSession, stopSession, pauseSession, getTranscript, reset,
    sendText, setAudioMuted, setMicEnabled,
  };
}
