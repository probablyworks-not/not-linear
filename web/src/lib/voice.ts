// Voice input: live speech-to-text via AssemblyAI's Universal-Streaming (v3) API.
// Ported from frontend/core/voice.js — dictation only, no text-to-speech, no voice commands.
// startVoiceCapture() captures the mic, streams 16kHz PCM audio to AssemblyAI over a
// WebSocket, and calls onPartial/onFinal as transcripts arrive; useVoiceInput() wraps that
// in a React hook for the composer components to drive their own text state with.
//
// The AssemblyAI API key never leaves this module as a WebSocket query param: browsers
// cannot set WS headers, so the key is exchanged once for a short-lived token via the
// backend's /__notlinear_assemblyai_token (backend/app/routers/voice.py), and only that
// token goes in the wss:// URL. The key itself lives in readApiKeys().assemblyai exactly
// like every other provider key (see lib/api-keys.ts).

import { useRef, useState } from 'react';
import { readApiKeys } from './api-keys';
import { LOCAL_HEADER } from './api';

const TOKEN_ENDPOINT = '/__notlinear_assemblyai_token';
const SAMPLE_RATE = 16000;

interface AssemblyAiTokenResponse { ok: boolean; token?: string; error?: string }

// Turns a getUserMedia rejection into a message that says what actually happened, rather than
// one generic string for "denied", "no device" and "in use elsewhere" alike.
function micErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : undefined;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return "Microphone access is blocked for this site — allow it in your browser's site settings, then try again.";
    case 'NotFoundError':
      return 'No microphone was found.';
    case 'NotReadableError':
      return 'The microphone is already in use by another application.';
    default:
      return 'Microphone access was denied or is unavailable.';
  }
}

async function fetchToken(apiKey: string): Promise<string> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...LOCAL_HEADER },
    body: JSON.stringify({ key: apiKey }),
    signal: AbortSignal.timeout(10000),
  });
  const data = (await res.json()) as AssemblyAiTokenResponse;
  if (!data.ok || !data.token) throw new Error(data.error || 'Could not start voice input.');
  return data.token;
}

/** Downsamples/encodes a Float32 buffer (native AudioContext rate) to 16-bit PCM at SAMPLE_RATE. */
function encodePcm16(float32: Float32Array, inputRate: number): ArrayBuffer {
  const ratio = inputRate / SAMPLE_RATE;
  const outLength = Math.floor(float32.length / ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const s = Math.max(-1, Math.min(1, float32[Math.floor(i * ratio)] ?? 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

interface AssemblyTurnMessage {
  type?: string;
  transcript?: string;
  turn_is_formatted?: boolean;
  end_of_turn?: boolean;
  turn_order?: number;
}

export interface VoiceCaptureHandlers {
  onPartial?(text: string): void;
  onFinal?(text: string): void;
  onError?(message: string): void;
  onStop?(): void;
}

/** Begins mic capture + live transcription. Returns a stop() function; safe to call more than once. */
export function startVoiceCapture({ onPartial, onFinal, onError, onStop }: VoiceCaptureHandlers = {}): () => void {
  let stopped = false;
  let ws: WebSocket | null = null;
  let stream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let silentOut: GainNode | null = null;

  function cleanup(): void {
    try { processor?.disconnect(); } catch { /* already disconnected */ }
    try { silentOut?.disconnect(); } catch { /* already disconnected */ }
    try { source?.disconnect(); } catch { /* already disconnected */ }
    try { void audioCtx?.close(); } catch { /* already closed */ }
    try { stream?.getTracks().forEach(t => t.stop()); } catch { /* already stopped */ }
    try { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'Terminate' })); } catch { /* socket already closing */ }
    try { ws?.close(); } catch { /* already closed */ }
  }

  const fail = (message: string): void => {
    if (stopped) return;
    stopped = true;
    cleanup();
    onError?.(message);
  };

  void (async () => {
    const apiKey = readApiKeys().assemblyai;
    if (!apiKey) {
      fail('No AssemblyAI API key — add it in Settings (⚙).');
      return;
    }
    // getUserMedia MUST run before any `await` (including the token fetch below): a click's
    // "user activation" is transient and can expire during a network round trip, after which
    // the browser silently rejects getUserMedia instead of ever showing the permission prompt.
    // That looked like "it's not even asking" — this ordering is the fix.
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      fail(micErrorMessage(e));
      return;
    }
    if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }

    let token: string;
    try {
      token = await fetchToken(apiKey);
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Could not start voice input.');
      return;
    }
    if (stopped) return;

    ws = new WebSocket(
      `wss://streaming.assemblyai.com/v3/ws?sample_rate=${SAMPLE_RATE}&formatted_finals=true&token=${encodeURIComponent(token)}`,
    );
    ws.binaryType = 'arraybuffer';
    ws.onerror = () => fail('Voice input connection failed.');
    ws.onclose = (ev) => { if (!stopped && ev.code !== 1000) fail('Voice input connection closed.'); };

    // AssemblyAI sends repeated Turn messages per logical utterance: `transcript` is always the
    // FULL text of that turn so far (not a delta), identified by `turn_order`. With
    // formatted_finals=true, end_of_turn fires twice for the same turn_order — once unformatted,
    // once (shortly after) with turn_is_formatted and punctuation/casing applied. Treating both
    // as independent "final" events (the original bug) appended the same turn's text twice, and
    // every later turn kept compounding on top — hence transcripts like "Uh, tell me Uh, tell
    // me…". Only the formatted end-of-turn message commits, and only once per turn_order.
    let committedTurnOrder = -1;
    ws.onmessage = (ev: MessageEvent<string>) => {
      let msg: AssemblyTurnMessage;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type !== 'Turn') return;
      const text = msg.transcript || '';
      if (!text) return;
      if (msg.end_of_turn && msg.turn_is_formatted) {
        if (msg.turn_order === committedTurnOrder) return;
        committedTurnOrder = msg.turn_order ?? committedTurnOrder;
        onFinal?.(text);
      } else {
        onPartial?.(text);
      }
    };

    ws.onopen = () => {
      if (stopped || !stream) return;
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new AudioCtx();
      source = audioCtx.createMediaStreamSource(stream);
      // ScriptProcessorNode is deprecated but needs no separate worklet file; 4096-sample
      // buffers keep latency low (~85ms @ 48kHz) without flooding the socket with tiny frames.
      processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        if (stopped || !ws || ws.readyState !== WebSocket.OPEN || !audioCtx) return;
        const input = e.inputBuffer.getChannelData(0);
        ws.send(encodePcm16(input, audioCtx.sampleRate));
      };
      // The mic must never be audible — route through a zero-gain node rather than
      // connecting processor straight to destination (ScriptProcessorNode only fires
      // onaudioprocess while connected through to the destination).
      silentOut = audioCtx.createGain();
      silentOut.gain.value = 0;
      source.connect(processor);
      processor.connect(silentOut);
      silentOut.connect(audioCtx.destination);
    };
  })();

  return function stop(): void {
    if (stopped) return;
    stopped = true;
    cleanup();
    onStop?.();
  };
}

export interface UseVoiceInputOptions {
  onPartial(text: string): void;
  onFinal(text: string): void;
  onError(message: string): void;
}

/** React wrapper around startVoiceCapture: tracks recording state, exposes a single toggle(). */
export function useVoiceInput({ onPartial, onFinal, onError }: UseVoiceInputOptions): { recording: boolean; toggle(): void } {
  const [recording, setRecording] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  const toggle = (): void => {
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = null;
      setRecording(false);
      return;
    }
    setRecording(true);
    stopRef.current = startVoiceCapture({
      onPartial,
      onFinal,
      onError: (message) => { stopRef.current = null; setRecording(false); onError(message); },
      onStop: () => { stopRef.current = null; setRecording(false); },
    });
  };

  return { recording, toggle };
}
