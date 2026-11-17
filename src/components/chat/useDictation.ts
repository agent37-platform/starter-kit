"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readVoicePrefs } from "@/lib/voice";
import { downsample, encodeWav } from "@/lib/wav";

// The chat's dictation: the microphone is captured as raw samples and sent as a WAV (the format
// the speech service reads), in the language chosen for the expert's calls.

/** A long dictation is cut into pieces sent while the member keeps talking: each piece stays far under
 * the host's 4 MB body limit (a WAV at 16 kHz is 32 kB a second) and is transcribed in seconds, so
 * nothing is lost to a size refusal or a slow answer. A piece closes on a quiet moment after
 * SEGMENT_MIN_SECONDS, and at SEGMENT_MAX_SECONDS whatever happens. Leslie, 06/11: long notes cut off.
 * The maximum stays under Aethex's 40 s per file (HTTP 413 beyond). Short pieces (Leslie, 16/11: « la
 * transcription est très lente »): what is left to send when the member stops is a few seconds of sound,
 * not half a minute, so the text arrives about three times sooner on a slow connection. */
const SEGMENT_MIN_SECONDS = 8;
const SEGMENT_MAX_SECONDS = 14;
/** Below this level (RMS of one audio buffer) the member is between two words. */
const QUIET_RMS = 0.012;
/** Ten minutes at most, then the dictation stops and is transcribed. */
const MAX_SECONDS = 600;
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
  const rec = useRef<{
    stream: MediaStream;
    ctx: AudioContext;
    node: ScriptProcessorNode;
    /** Samples of the piece being recorded. */
    chunks: Float32Array[];
    /** Samples in `chunks`. */
    length: number;
    /** Pieces already sent, in order. */
    parts: Promise<string>[];
    /** Loudest sample heard over the whole dictation, and samples recorded in all. */
    peak: number;
    total: number;
    timer: ReturnType<typeof setInterval>;
    t0: number;
  } | null>(null);

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

  // One piece to text. Throws a sentence for the member when it fails twice.
  const sendPiece = useCallback(
    async (samples: Float32Array, rate: number): Promise<string> => {
      const wav = new Blob([encodeWav(downsample(samples, rate))], { type: "audio/wav" });
      const language = expert ? readVoicePrefs(expert).language : "fr";
      const send = async () => {
        const form = new FormData();
        form.append("file", wav, "dictee.wav");
        form.append("language", language);
        const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
        return { res, data };
      };
      // The piece is kept: a network hiccup or a speech service that does not answer gets a
      // second try instead of losing what was said. A refusal (4xx) is final.
      let out = await send().catch(() => null);
      if (!out || out.res.status >= 500) {
        await new Promise((r) => setTimeout(r, RETRY_AFTER_MS));
        out = await send().catch(() => null);
      }
      if (!out) throw new Error("La connexion a coupé pendant l’envoi de la dictée. Réessayez.");
      if (!out.res.ok) throw new Error(out.data.error?.message ?? "La dictée n’a pas pu être transcrite.");
      return out.data.text?.trim() ?? "";
    },
    [expert]
  );

  // Closes the piece being recorded and sends it, unless it is pure silence (a pause, a muted microphone).
  const cut = useCallback(
    (r: NonNullable<typeof rec.current>) => {
      if (!r.length) return;
      const all = new Float32Array(r.length);
      r.chunks.reduce((at, c) => (all.set(c, at), at + c.length), 0);
      r.chunks = [];
      r.length = 0;
      let peak = 0;
      for (let i = 0; i < all.length; i += 64) peak = Math.max(peak, Math.abs(all[i]!));
      r.peak = Math.max(r.peak, peak);
      r.total += all.length;
      if (peak < 0.001 || all.length < r.ctx.sampleRate / 2) return;
      const part = sendPiece(all, r.ctx.sampleRate);
      part.catch(() => undefined); // read in order by finish(); never an unhandled rejection meanwhile
      r.parts.push(part);
    },
    [sendPiece]
  );

  const finish = useCallback(() => {
    const live = rec.current;
    if (!live) return;
    cut(live);
    const r = release()!;
    const heldMs = Date.now() - r.t0;
    if (!r.parts.length) {
      setState("idle");
      // Held over a second and nothing worth sending: the microphone gave nothing (an audio context
      // left paused by the browser) or only silence. Said, never a button that silently resets.
      if (r.total >= r.ctx.sampleRate / 2 && r.peak < 0.001) return onError("Rien n’a été entendu : vérifiez que le bon micro est choisi et qu’il n’est pas coupé.");
      if (heldMs > 1000) onError("Le micro n’a rien enregistré. Réessayez.");
      return;
    }
    setState("transcribing");
    void (async () => {
      const texts: string[] = [];
      let failed: string | null = null;
      for (const part of r.parts) {
        try {
          const t = await part;
          if (t) texts.push(t);
        } catch (e) {
          failed ??= (e as Error).message;
        }
      }
      // What was transcribed is never thrown away because one piece failed.
      if (texts.length) onText(texts.join(" "));
      if (failed) onError(texts.length ? "Une partie de la dictée n’a pas pu être transcrite. Vérifiez le texte." : failed);
      else if (!texts.length) onError("Rien n’a été entendu. Réessayez plus près du micro.");
      setState("idle");
    })();
  }, [cut, release, onError, onText]);

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
      const rate = ctx.sampleRate;
      node.onaudioprocess = (e) => {
        const r = rec.current;
        if (!r) return;
        const data = e.inputBuffer.getChannelData(0);
        r.chunks.push(new Float32Array(data));
        r.length += data.length;
        let sum = 0;
        for (const s of data) sum += s * s;
        const rms = Math.sqrt(sum / data.length);
        setLevel(Math.min(1, rms * 4));
        const held = r.length / rate;
        if (held >= SEGMENT_MAX_SECONDS || (held >= SEGMENT_MIN_SECONDS && rms < QUIET_RMS)) cut(r);
      };
      ctx.createMediaStreamSource(stream).connect(node);
      node.connect(ctx.destination);
      const t0 = Date.now();
      const timer = setInterval(() => {
        const s = Math.floor((Date.now() - t0) / 1000);
        setSeconds(s);
        if (s >= MAX_SECONDS) finish();
      }, 250);
      rec.current = { stream, ctx, node, chunks: [], length: 0, parts: [], peak: 0, total: 0, timer, t0 };
      setSeconds(0);
      setState("recording");
    } catch (e) {
      void ctx?.close().catch(() => {});
      const denied = (e as DOMException).name === "NotAllowedError";
      onError(denied ? "Autorisez le micro pour dicter votre message." : "Le micro n’a pas pu être ouvert.");
    }
  }, [cut, finish, onError]);

  const cancel = useCallback(() => {
    release();
    setState("idle");
  }, [release]);

  useEffect(() => () => void release(), [release]);

  return { state, seconds, level, start, finish, cancel };
}
