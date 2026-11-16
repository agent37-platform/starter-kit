"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readVoicePrefs } from "@/lib/voice";
import { downsample, encodeWav } from "@/lib/wav";

// The chat's dictation: the microphone is captured as raw samples and sent as a WAV (the format
// the speech service reads), in the language chosen for the expert's calls.

/** Two minutes: a WAV at 16 kHz is 32 kB a second, and the host refuses a request over 4 MB before
 * the route sees it (src/lib/upload-limit.ts). Longer, the dictation was lost with a vague error. */
const MAX_SECONDS = 120;
/** A transcription that fails for a reason worth a second try (network, speech service down) is sent
 * once more, after this pause, before the member sees an error. */
const RETRY_AFTER_MS = 1200;

export type DictationState = "idle" | "recording" | "transcribing";

export interface UseDictation {
  state: DictationState;
  seconds: number;
  /** Microphone level, 0 to 1, for the meter. */
  level: number;
  start(): Promise<void>;
  /** Stops and transcribes; the text goes to `onText`. */
  finish(): void;
  cancel(): void;
}

/** `expert`: catalogue key whose call language the dictation takes; French without one. */
export function useDictation({ expert, onText, onError }: { expert: string | null; onText: (text: string) => void; onError: (message: string) => void }): UseDictation {
  const [state, setState] = useState<DictationState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const rec = useRef<{ stream: MediaStream; ctx: AudioContext; node: ScriptProcessorNode; chunks: Float32Array[]; timer: ReturnType<typeof setInterval>; t0: number } | null>(null);

  const release = useCallback(() => {
    const r = rec.current;
    rec.current = null;
    if (!r) return null;
    clearInterval(r.timer);
    r.node.disconnect();
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx.close().catch(() => {});
    setLevel(0);
    return r;
  }, []);

  const transcribe = useCallback(
    async (chunks: Float32Array[], rate: number, heldMs: number) => {
      const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
      chunks.reduce((at, c) => (all.set(c, at), at + c.length), 0);
      if (all.length < rate / 2) {
        setState("idle");
        // Held over a second and still under half a second of sound: the microphone gave nothing
        // (an audio context left paused by the browser). Said, never a button that silently resets.
        if (heldMs > 1000) onError("Le micro n’a rien enregistré. Réessayez.");
        return;
      }
      // A recording of pure silence (a muted or wrong microphone) is not sent to the speech service.
      let peak = 0;
      for (let i = 0; i < all.length; i += 64) peak = Math.max(peak, Math.abs(all[i]!));
      if (peak < 0.001) {
        setState("idle");
        return onError("Rien n’a été entendu : vérifiez que le bon micro est choisi et qu’il n’est pas coupé.");
      }
      setState("transcribing");
      try {
        const wav = new Blob([encodeWav(downsample(all, rate))], { type: "audio/wav" });
        const language = expert ? readVoicePrefs(expert).language : "fr";
        const send = async () => {
          const form = new FormData();
          form.append("file", wav, "dictee.wav");
          form.append("language", language);
          const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
          const data = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
          // The host refuses a body too large before the route, with a page instead of JSON.
          if (res.status === 413) data.error = { message: "Dictée trop longue : environ 2 minutes au plus. Coupez-la en deux." };
          return { res, data };
        };
        // The recording is kept: a network hiccup or a speech service that does not answer gets a
        // second try instead of losing what was said. A refusal (4xx) is final.
        let out = await send().catch(() => null);
        if (!out || out.res.status >= 500) {
          await new Promise((r) => setTimeout(r, RETRY_AFTER_MS));
          out = await send().catch(() => null);
        }
        if (!out) throw new Error("La connexion a coupé pendant l’envoi de la dictée. Réessayez.");
        const { res, data } = out;
        if (!res.ok) throw new Error(data.error?.message ?? "La dictée n’a pas pu être transcrite.");
        if (data.text?.trim()) onText(data.text.trim());
        else onError("Rien n’a été entendu. Réessayez plus près du micro.");
      } catch (e) {
        onError((e as Error).message);
      } finally {
        setState("idle");
      }
    },
    [expert, onError, onText]
  );

  const finish = useCallback(() => {
    const r = release();
    if (r) void transcribe(r.chunks, r.ctx.sampleRate, Date.now() - r.t0);
  }, [release, transcribe]);

  const start = useCallback(async () => {
    if (rec.current || !navigator.mediaDevices?.getUserMedia) return onError("Ce navigateur ne permet pas la dictée.");
    // The audio context is made in the click itself, before waiting for the microphone: made after,
    // Safari (and Chrome at times) leaves it paused, nothing is recorded and the dictation was lost.
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      node.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(data));
        let sum = 0;
        for (const s of data) sum += s * s;
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      };
      ctx.createMediaStreamSource(stream).connect(node);
      node.connect(ctx.destination);
      const t0 = Date.now();
      const timer = setInterval(() => {
        const s = Math.floor((Date.now() - t0) / 1000);
        setSeconds(s);
        if (s >= MAX_SECONDS) finish();
      }, 250);
      rec.current = { stream, ctx, node, chunks, timer, t0 };
      setSeconds(0);
      setState("recording");
    } catch (e) {
      void ctx?.close().catch(() => {});
      const denied = (e as DOMException).name === "NotAllowedError";
      onError(denied ? "Autorisez le micro pour dicter votre message." : "Le micro n’a pas pu être ouvert.");
    }
  }, [finish, onError]);

  const cancel = useCallback(() => {
    release();
    setState("idle");
  }, [release]);

  useEffect(() => () => void release(), [release]);

  return { state, seconds, level, start, finish, cancel };
}
