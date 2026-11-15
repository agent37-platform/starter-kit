"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AethexError, VoiceCall, WebRTCPlatform } from "@aethexai/react/core";
import type { VoiceLanguage } from "@/lib/voice";
import { firstTurn, stepTurn, type CallPhase, type TurnState } from "@/lib/call-turns";
import { micMeter, withMicTap, type MicMeter } from "@/lib/mic-tap";
import { playHangupTone } from "./useRingback";

// One call with an expert, from the browser. Signaling goes to this app's own /api/voice, which adds
// the session and the workspace; only the audio goes straight to Aethex (WebRTC). Ported from the
// voice app's aethexCall.ts. The SDK says nothing of turns: "speaking" is read from the expert's output
// level, and "thinking" (between the end of the member's sentence and the expert's voice) from the
// member's microphone too, measured on the very stream the SDK sends (src/lib/call-turns.ts).
//
// « Réfléchis plus longtemps » goes to the back office (`calls/:id/think-longer`), which asks the expert to
// think harder; « Laisse-moi finir » is `{ type: 'hold-floor', on }` on the call's data channel, handled by
// Aethex. Both are sent again once the call is up. Locally they also lengthen the thinking wait and keep
// the member's pauses from ending their turn.
//
// What was said, and the expert's tools at work, come from Aethex's RTVI messages on the call's data
// channel (`bot-output`, the member's final `user-transcription`, `llm-function-call-in-progress` and
// `-stopped`), read as the mobile app does: the peer connection's data channels are listened to.

export type { CallPhase };

/** One line of the live transcript. */
export interface Caption {
  who: "expert" | "member";
  text: string;
  at: number;
}

const MAX_CAPTIONS = 60;

const VOICE_BASE = "/api/voice";
const LEVEL_MS = 80;

function messageOf(e: AethexError): string | null {
  if (e.code === "mic_denied" || e.code === "mic_missing") return "Autorisez le micro pour appeler vos experts.";
  if (e.code === "unsupported_browser") return "Ce navigateur ne permet pas les appels. Essayez Chrome, Edge ou Safari à jour.";
  if (e.code === "quota_exceeded" || e.code === "payment_required" || e.code === "capacity") return "Service vocal indisponible. Réessayez dans un instant.";
  return null;
}

export interface UseVoiceCall {
  phase: CallPhase;
  /** Why the call could not go on, in French; null when it ended normally. */
  reason: string | null;
  muted: boolean;
  /** « Réfléchis plus longtemps » and « Laisse-moi finir ». */
  longer: boolean;
  holding: boolean;
  /** Seconds since the expert picked up. */
  elapsed: number;
  /** What was said so far, oldest first. */
  captions: Caption[];
  /** One of the expert's tools is at work (it searches). */
  tool: boolean;
  start(input: { expert: string; language: VoiceLanguage; voice: string | null }): void;
  hangUp(): void;
  setMuted(muted: boolean): void;
  /** Each returns the new state. */
  /** `onFail`: the back office refused, the switch is already back. */
  toggleLonger(onFail?: () => void): boolean;
  toggleHold(): boolean;
}

export function useVoiceCall(): UseVoiceCall {
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [reason, setReason] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [longer, setLonger] = useState(false);
  const [holding, setHolding] = useState(false);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [tool, setTool] = useState(false);
  const tools = useRef(new Set<string>());
  const call = useRef<VoiceCall | null>(null);
  const mic = useRef<MicMeter | null>(null);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);
  const phaseRef = useRef<CallPhase>("idle");
  const switches = useRef({ muted: false, longer: false, holding: false });
  const answered = useRef(false);
  const unlisten = useRef<(() => void) | null>(null);
  // Bumped by every release: an SDK still loading for an abandoned call is dropped.
  const attempt = useRef(0);

  const go = useCallback((next: CallPhase) => {
    if (phaseRef.current === "ended" || phaseRef.current === "unreachable") return;
    // The short end tone, once, when a call the expert had answered ends (either side).
    if (next === "ended" && answered.current) playHangupTone();
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const release = useCallback(() => {
    attempt.current++;
    tools.current.clear();
    setTool(false);
    timers.current.forEach(clearInterval);
    timers.current = [];
    unlisten.current?.();
    unlisten.current = null;
    call.current?.stop();
    call.current = null;
    mic.current?.close();
    mic.current = null;
  }, []);

  const sendLonger = useCallback(async (on: boolean) => {
    const id = call.current?.getSessionId();
    if (!id) throw new Error("call not connected");
    const res = await fetch(`${VOICE_BASE}/calls/${encodeURIComponent(id)}/think-longer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on }),
    });
    if (!res.ok) throw new Error(`think-longer ${res.status}`);
  }, []);

  const fail = useCallback(
    (why: string | null) => {
      release();
      setReason(why ?? "L’expert est injoignable pour le moment. Réessayez dans un instant.");
      go("unreachable");
    },
    [go, release]
  );

  const onServerMessage = useCallback((raw: unknown) => {
    if (typeof raw !== "string" || phaseRef.current === "ended" || phaseRef.current === "unreachable") return;
    let m: { label?: unknown; type?: unknown; data?: { text?: unknown; final?: unknown; tool_call_id?: unknown } } | null;
    try {
      m = JSON.parse(raw);
    } catch {
      return; // not JSON
    }
    if (m?.label !== "rtvi-ai") return;
    const d = m.data;
    if (m.type === "bot-output" || (m.type === "user-transcription" && d?.final === true)) {
      const text = typeof d?.text === "string" ? d.text.trim() : "";
      if (!text) return;
      const who: Caption["who"] = m.type === "bot-output" ? "expert" : "member";
      setCaptions((c) => {
        const last = c[c.length - 1];
        // The expert's sentences arrive one by one: they join its current line.
        const next = last && last.who === who && who === "expert" && Date.now() - last.at < 4000 ? [...c.slice(0, -1), { ...last, text: `${last.text} ${text}`, at: Date.now() }] : [...c, { who, text, at: Date.now() }];
        return next.slice(-MAX_CAPTIONS);
      });
      return;
    }
    const id = d?.tool_call_id;
    if (typeof id !== "string") return;
    if (m.type === "llm-function-call-in-progress") tools.current.add(id);
    else if (m.type === "llm-function-call-stopped") tools.current.delete(id);
    else return;
    setTool(tools.current.size > 0);
  }, []);

  // Turns from the two levels; a reconnection starts them again.
  const meter = useCallback(() => {
    let turn: TurnState = firstTurn();
    return () => {
      const state = phaseRef.current;
      if (state !== "listening" && state !== "speaking" && state !== "thinking") {
        turn = firstTurn();
        return;
      }
      const sw = switches.current;
      turn = stepTurn(turn, {
        now: Date.now(),
        voice: call.current?.getOutputLevel() ?? 0,
        mic: sw.muted ? 0 : (mic.current?.level() ?? 0),
        holding: sw.holding,
        longer: sw.longer,
      });
      if (turn.phase !== state) go(turn.phase);
    };
  }, [go]);

  const start = useCallback<UseVoiceCall["start"]>(
    ({ expert, language, voice }) => {
      release();
      phaseRef.current = "connecting";
      setPhase("connecting");
      setReason(null);
      setElapsed(0);
      answered.current = false;
      switches.current = { muted: false, longer: false, holding: false };
      setMutedState(false);
      setLonger(false);
      setHolding(false);
      setCaptions([]);
      tools.current.clear();
      setTool(false);
      const mine = attempt.current;
      // The SDK loads with the first call, not with every page.
      import("@aethexai/react/core").then(({ VoiceCall, webPlatform }) => {
        if (attempt.current !== mine) return;
        // The SDK's own browser adapter, every field kept, with the microphone stream also measured and
        // the data channels listened to.
        const platform = listening(
          withMicTap(webPlatform, (stream) => {
            mic.current?.close();
            mic.current = micMeter(stream);
          }),
          onServerMessage
        );
        let refusal: string | null = null;
        // The back office's refusal ("Cet expert n'est pas encore disponible.") is in the body, which the SDK does not read.
        const fetchImpl: typeof fetch = async (input, init) => {
          const res = await fetch(input, init);
          if (!res.ok && String(input).endsWith(`${VOICE_BASE}/calls`)) {
            refusal = ((await res.clone().json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? null;
          }
          return res;
        };
        let connected = false;
        let peer: RTCPeerConnectionState = "new";
        const back = () => {
          go("listening");
          if (switches.current.holding) call.current?.send({ type: "hold-floor", on: true });
        };
        try {
          const c = new VoiceCall({
            agentId: "yelema", // ignored: the back office picks the agent
            apiBaseUrl: VOICE_BASE,
            endpoints: { connect: "calls", offer: "calls/:id/offer", ice: "calls/:id/ice", end: "calls/:id/end", status: "calls/:id/status" },
            headers: { "X-Yelema-Expert": expert, "X-Yelema-Language": language, ...(voice ? { "X-Yelema-Voice": voice } : {}) },
            fetchImpl,
            platform,
            callbacks: {
              onStatusChange: (s) => {
                if (s === "connected" && !connected) {
                  connected = true;
                  answered.current = true;
                  go("listening");
                  const sw = switches.current;
                  if (sw.longer)
                    sendLonger(true).catch(() => {
                      if (call.current !== c || !switches.current.longer) return;
                      switches.current.longer = false;
                      setLonger(false);
                    });
                  if (sw.holding) c.send({ type: "hold-floor", on: true });
                  const t0 = Date.now();
                  timers.current.push(setInterval(meter(), LEVEL_MS), setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000));
                  // The browser knows the network is gone seconds before the peer connection does.
                  const offline = () => {
                    const ph = phaseRef.current;
                    if (ph === "listening" || ph === "speaking" || ph === "thinking") go("reconnecting");
                  };
                  const online = () => {
                    if (peer === "connected" && phaseRef.current === "reconnecting") back();
                  };
                  window.addEventListener("offline", offline);
                  window.addEventListener("online", online);
                  unlisten.current = () => {
                    window.removeEventListener("offline", offline);
                    window.removeEventListener("online", online);
                  };
                  if (!navigator.onLine) offline();
                } else if (s === "ended") {
                  release();
                  go("ended");
                }
              },
              onPeerStateChange: (p) => {
                peer = p;
                if (!connected) return;
                if (p === "disconnected" || p === "failed") go("reconnecting");
                else if (p === "connected" && phaseRef.current === "reconnecting" && navigator.onLine) back();
              },
              onError: (e) => fail(refusal ?? messageOf(e)),
              onClose: () => {
                release();
                go("ended");
              },
            },
          });
          call.current = c;
          c.start().catch(() => fail(refusal));
        } catch {
          fail(refusal);
        }
      }, () => attempt.current === mine && fail(null));
    },
    [fail, go, meter, onServerMessage, release, sendLonger]
  );

  const hangUp = useCallback(() => {
    release();
    go("ended");
  }, [go, release]);

  const setMuted = useCallback((m: boolean) => {
    switches.current.muted = m;
    setMutedState(m);
    call.current?.setMuted(m);
  }, []);

  const toggleLonger = useCallback<UseVoiceCall["toggleLonger"]>(
    (onFail) => {
      const on = !switches.current.longer;
      switches.current.longer = on;
      setLonger(on);
      const c = call.current;
      // Before the call is up there is no conversation yet: the switch is sent once it is.
      if (c?.getSessionId())
        sendLonger(on).catch(() => {
          // A later tap, or another call, wins.
          if (call.current !== c || switches.current.longer !== on) return;
          switches.current.longer = !on;
          setLonger(!on);
          onFail?.();
        });
      return on;
    },
    [sendLonger]
  );

  const toggleHold = useCallback(() => {
    const on = !switches.current.holding;
    switches.current.holding = on;
    setHolding(on);
    // The whole state, not a toggle: a repeated or late message stays harmless.
    if (call.current?.getSessionId()) call.current.send({ type: "hold-floor", on });
    return on;
  }, []);

  // Leaving the page hangs up: the SDK sends `end`, and the back office closes the call at Aethex.
  useEffect(() => release, [release]);

  return { phase, reason, muted, longer, holding, elapsed, captions, tool, start, hangUp, setMuted, toggleLonger, toggleHold };
}

/** The adapter with every data channel the SDK opens also heard by `onMessage`. */
function listening(base: WebRTCPlatform, onMessage: (data: unknown) => void): WebRTCPlatform {
  return {
    ...base,
    createPeerConnection: (config) => {
      const pc = base.createPeerConnection(config);
      const open = pc.createDataChannel.bind(pc);
      pc.createDataChannel = (label, init) => {
        const channel = open(label, init);
        channel.addEventListener("message", (ev) => onMessage(ev.data));
        return channel;
      };
      // A channel the server opens itself.
      pc.addEventListener("datachannel", (ev) => ev.channel.addEventListener("message", (e) => onMessage(e.data)));
      return pc;
    },
  };
}
