"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { GoogleGenAI, Modality, type LiveServerMessage } from "@google/genai";

const ENABLE_STT_FALLBACK = true;

export type SessionStatus = "idle" | "connecting" | "live" | "ending" | "ended" | "paused" | "error";
export interface Turn { role: "child" | "k"; text: string }

export interface UseGeminiLiveOptions {
  /** 한 턴이 완전히 끝날 때마다 호출.
   *  - child: 음성 인식 완료 or sendText 호출 직후
   *  - k: Gemini turnComplete 이벤트 수신 시 (스트리밍 전체 텍스트)
   */
  onTurnComplete?: (turn: Turn) => void;
  /** child 발화 전사 소스.
   *  - "gemini"(기본): Gemini Live 자체 전사 + 브라우저 웹킷 폴백 (자유대화)
   *  - "gcp": child 턴 오디오를 /api/mission/stt(GCP Speech-to-Text)로 전사 (미션 전용)
   */
  sttMode?: "gemini" | "gcp";
  /** Live API 음성(speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName). 기본값 "Aoede".
   *  연결 시점에 확정되므로 변경 시 세션을 재연결해야 반영된다(임시 목소리 테스트 드롭다운용). */
  voiceName?: string;
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
  // 브라우저 SpeechRecognition 폴백의 중간(interim) 전사 — 아이가 말하는 도중 실시간 자막용.
  // outputAudioTranscription(outTx) 이벤트와 무관하게, 브라우저 자체 인식 결과로만 갱신/확정된다.
  const [interimChildText, setInterimChildText] = useState("");

  const statusRef     = useRef<SessionStatus>("idle");
  const transcriptRef = useRef<Turn[]>([]);
  const sessionRef    = useRef<Awaited<ReturnType<InstanceType<typeof GoogleGenAI>["live"]["connect"]>> | null>(null);
  const micStreamRef  = useRef<MediaStream | null>(null);
  const processorRef  = useRef<ScriptProcessorNode | null>(null);
  const inputCtxRef   = useRef<AudioContext | null>(null);
  const outputCtxRef  = useRef<AudioContext | null>(null);
  const audioMutedRef = useRef(false);
  const micEnabledRef = useRef(true);
  // K 발화 재생 중 여부 — true인 동안 마이크 PCM 전송과 브라우저 STT 폴백을 모두 멈춰서
  // 스피커로 나온 K 목소리가 마이크로 다시 들어와 아이 발화로 오인되는 에코 루프를 막는다
  // (useVoiceChat.ts의 speakingRef와 동일한 목적, echoCancellation 브라우저 제약만으로는
  //  WebAudio API로 재생하는 오디오를 AEC 기준 신호로 못 잡는 경우가 있어 반드시 필요).
  const kSpeakingRef = useRef(false);

  // 로컬 STT fallback 관리 변수
  const recognitionRef = useRef<any>(null);
  const speechHistoryRef = useRef<string>("");
  const hasLiveInputTxRef = useRef<boolean>(false);

  // ── 스케줄 기반 오디오 재생 (갭 없는 gapless 재생) ─────────
  // 이전 큐/playNext 방식은 onended→start 사이 JS 이벤트 루프 갭으로 파직거림 발생.
  // AudioContext.currentTime 기반 startAt 스케줄링으로 버퍼 경계 클릭 제거.
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextScheduleTimeRef = useRef(0);

  // 콜백 ref — 렌더마다 최신 함수 유지
  const onTurnCompleteRef = useRef<((turn: Turn) => void) | undefined>(undefined);
  onTurnCompleteRef.current = options?.onTurnComplete;

  // STT 모드 ref — startSession 클로저에서 최신값 참조
  const sttModeRef = useRef<"gemini" | "gcp">(options?.sttMode ?? "gemini");
  sttModeRef.current = options?.sttMode ?? "gemini";

  // Live 음성 ref — startSession 클로저(연결 시점)에서 최신값 참조
  const voiceNameRef = useRef<string>(options?.voiceName ?? "Aoede");
  voiceNameRef.current = options?.voiceName ?? "Aoede";

  // GCP STT용 child 턴 오디오 버퍼 (PCM16 raw bytes 청크) — 매 턴 flush 후 리셋
  const childAudioChunksRef = useRef<Uint8Array[]>([]);

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
      kSpeakingRef.current = true; // 재생 시작 — 마이크 무음 유지
      source.onended = () => {
        const arr = scheduledSourcesRef.current;
        const i = arr.indexOf(source);
        if (i !== -1) arr.splice(i, 1);
        if (arr.length === 0) kSpeakingRef.current = false; // 마지막 버퍼 재생 종료 — 마이크 재개
      };
    } catch { /* 손상된 프레임 무시 */ }
  }

  function stopAllScheduledSources() {
    scheduledSourcesRef.current.forEach(src => { try { src.stop(); } catch { /* already stopped */ } });
    scheduledSourcesRef.current = [];
    nextScheduleTimeRef.current = 0;
    kSpeakingRef.current = false;
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

  function concatChunksToBase64(chunks: Uint8Array[]): string {
    let total = 0;
    for (const c of chunks) total += c.length;
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }
    let binary = "";
    for (let i = 0; i < merged.length; i++) binary += String.fromCharCode(merged[i]);
    return btoa(binary);
  }

  // child 턴 flush — gemini 모드는 즉시 동기 처리(기존 동작 유지),
  // gcp 모드는 누적 오디오를 /api/mission/stt로 전사(fire-and-forget)해 최종 텍스트로 콜백.
  function flushChildTurn(fallbackText: string) {
    if (sttModeRef.current !== "gcp") {
      appendTurn({ role: "child", text: fallbackText });
      onTurnCompleteRef.current?.({ role: "child", text: fallbackText });
      return;
    }

    const chunks = childAudioChunksRef.current;
    childAudioChunksRef.current = [];

    void (async () => {
      let finalText = fallbackText;
      if (chunks.length > 0) {
        try {
          const audioBase64 = concatChunksToBase64(chunks);
          const res = await fetch("/api/mission/stt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64 }),
          });
          if (res.ok) {
            const { transcript } = await res.json();
            if (typeof transcript === "string" && transcript.trim()) {
              finalText = transcript.trim();
            }
          }
        } catch {
          // GCP 실패 시 gemini 전사(fallbackText) 그대로 사용
        }
      }
      if (finalText && finalText.trim()) {
        appendTurn({ role: "child", text: finalText });
        onTurnCompleteRef.current?.({ role: "child", text: finalText });
      }
    })();
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

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }

    childAudioChunksRef.current = [];
    setInterimChildText("");
  }

  const initSpeechRecognition = useCallback(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "ko-KR";

    rec.onresult = (event: any) => {
      // K가 발화 재생 중이면 스피커 소리가 마이크로 들어온 에코일 뿐이므로 완전히 무시(에코 루프 방지)
      if (kSpeakingRef.current) return;
      // Gemini 자체 inputTranscription이 이 턴에 대해 이미 도착했다면 폴백은 관여하지 않음(중복 방지)
      if (hasLiveInputTxRef.current) return;

      let interimTranscript = "";
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      const text = finalTranscript || interimTranscript;
      if (text.trim()) {
        speechHistoryRef.current = text.trim();
        console.log("[STT Fallback] interim text:", speechHistoryRef.current);
      }

      // 실시간 중간 자막 — outTx(케이 응답) 이벤트를 기다리지 않고 화면에 바로 반영
      if (interimTranscript.trim() || finalTranscript.trim()) {
        setInterimChildText((finalTranscript || interimTranscript).trim());
      }

      // 브라우저 자체 무음/구간 감지로 이 발화가 끝났다고 판단되면 즉시 확정 flush
      // (Gemini의 outputTranscription/turnComplete를 기다리지 않음 — 그게 안 와서 자막이 안 뜨던 문제의 핵심 수정)
      if (finalTranscript.trim()) {
        const finalText = finalTranscript.trim();
        speechHistoryRef.current = "";
        setInterimChildText("");
        flushChildTurn(finalText);
      }
    };

    rec.onerror = (e: any) => {
      console.warn("[STT Fallback] error:", e.error);
    };

    rec.onend = () => {
      if (statusRef.current === "live" && micEnabledRef.current && recognitionRef.current) {
        try { recognitionRef.current.start(); } catch {}
      }
    };

    recognitionRef.current = rec;
  }, []);

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
      // responseModalities는 AUDIO만 (TEXT 추가 시 native-audio 모델에서 에러 1011/1007로 끊김)
      // speechConfig.voiceName: Live 기본 음성 — 확정 아님, options.voiceName으로 외부 주입 가능(기본 "Aoede")
      const liveConfig = {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceNameRef.current } },
        },
      };
      console.log("[K] 🔊 Live voiceName:", voiceNameRef.current);

      const session = await ai.live.connect({
        model,
        config: liveConfig,
        callbacks: {
          onopen: () => {
            console.log("[K] ✅ WebSocket open");
            updateStatus("live");

            // 로컬 STT 폴백 시작 — gcp 모드에서는 브라우저 폴백을 켜지 않음(초기화도 안 함)
            if (ENABLE_STT_FALLBACK && sttModeRef.current !== "gcp") {
              initSpeechRecognition();
              try {
                recognitionRef.current?.start();
                console.log("[STT Fallback] webkitSpeechRecognition started");
              } catch (err) {
                console.warn("[STT Fallback] failed to start SpeechRecognition:", err);
              }
              speechHistoryRef.current = "";
              hasLiveInputTxRef.current = false;
            }
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
              
              // 라이브 전사 성공 시 로컬 STT는 무력화
              hasLiveInputTxRef.current = true;
              speechHistoryRef.current = "";
            }

            // ── 케이 응답 트랜스크립션 ────────────────────────────
            const outTx = (sc.outputTranscription as {text?: string} | undefined)?.text;
            if (outTx) {
              // K가 대답을 시작하기 전에 폴백 적용 확인
              if (ENABLE_STT_FALLBACK && !hasLiveInputTxRef.current && speechHistoryRef.current) {
                console.log("[STT Fallback] Gemini 전사 누락 감지. 로컬 STT 주입:", speechHistoryRef.current);
                pendingChildText = speechHistoryRef.current;
                speechHistoryRef.current = "";
              }

              // K가 말을 시작하는 순간 아이 버퍼 flush
              if (pendingChildText || (sttModeRef.current === "gcp" && childAudioChunksRef.current.length > 0)) {
                console.log("[K] 📝 child (flush):", pendingChildText);
                flushChildTurn(pendingChildText);
                pendingChildText = "";
              }
              console.log("[K] 💬 k:", outTx);
              appendTurn({ role: "k", text: outTx });
              pendingKText += outTx;

              // 다음 턴을 위해 전사 감지 플래그 초기화
              hasLiveInputTxRef.current = false;
            }

            // ── 턴 완료 ───────────────────────────────────────────
            if (sc.turnComplete) {
              if (pendingKText) {
                onTurnCompleteRef.current?.({ role: "k", text: pendingKText });
                pendingKText = "";
              }
              hasLiveInputTxRef.current = false;
              speechHistoryRef.current = "";
              setInterimChildText("");
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
            if (pendingChildText || (sttModeRef.current === "gcp" && childAudioChunksRef.current.length > 0)) {
              flushChildTurn(pendingChildText);
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
        // kSpeakingRef: K 발화 재생 중엔 마이크 전송 자체를 끊어 에코가 Gemini/브라우저 STT
        // 어느 쪽으로도 아이 발화로 들어가지 않게 한다(half-duplex, echoCancellation만으론 불충분).
        if (sessionRef.current && statusRef.current === "live" && micEnabledRef.current && !kSpeakingRef.current) {
          const float32 = ev.inputBuffer.getChannelData(0);
          const pcm = encodePCM16(float32);
          sessionRef.current.sendRealtimeInput({ audio: { data: pcm, mimeType: "audio/pcm;rate=16000" } });
          // gcp 모드: Gemini 전송과 별개로 현재 child 턴 오디오 버퍼에도 누적
          if (sttModeRef.current === "gcp") {
            const buf = new Int16Array(float32.length);
            for (let i = 0; i < float32.length; i++) {
              buf[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
            }
            childAudioChunksRef.current.push(new Uint8Array(buf.buffer.slice(0)));
          }
          if (++chunkCount % 40 === 1) console.log(`[K] 📡 PCM #${chunkCount}`);
        }
      };
      source.connect(processor);
      processor.connect(inputCtx.destination);

    } catch (err) {
      console.error("[K] 🚨 startSession error (voiceName:", voiceNameRef.current, "):", err);
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

  /** 케이가 특정 문장을 그대로 소리내어 말하게 함(미션 질문 등). sendText와 달리
   *  아이 발화로 취급하지 않는다 — 화면에는 케이(K) 말풍선으로 표시되고, onTurnComplete도
   *  role:"k"로 호출되어(child 판정/미션 답변 로직을 타지 않음) 대화 로그에는 남되 오답 처리되지 않는다. */
  const speakAsK = useCallback((text: string): boolean => {
    if (!sessionRef.current || statusRef.current !== "live") return false;
    appendTurn({ role: "k", text });
    onTurnCompleteRef.current?.({ role: "k", text });
    sessionRef.current.sendClientContent({
      turns: [{ role: "user", parts: [{ text: `다음 문장을 자연스럽게 소리내어 그대로 말해줘: "${text}"` }] }],
      turnComplete: true,
    });
    return true;
  }, []);

  useEffect(() => {
    return () => {
      teardown();
    };
  }, []);

  return {
    status, error, transcript, interimChildText,
    startSession, stopSession, pauseSession, getTranscript, reset,
    sendText, speakAsK, setAudioMuted, setMicEnabled, appendTurn,
  };
}
