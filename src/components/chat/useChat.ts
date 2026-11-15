"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, readApiError } from "@/lib/api";
import { cached, remember } from "@/lib/client-cache";
import { finishTiming, keepLast, mark, startTiming, type TurnTiming } from "@/lib/chat-timing";
import { chatFailureMessage, OFFLINE } from "@/lib/chat-errors";
import { batchQueued, insertBefore, isSteer, steerText, unreadSteerCount } from "@/lib/chat-queue";
import { profileQuery } from "@/lib/profile-id";
import { toolPhrase } from "@/lib/tool-steps";
import { isNetworkError, newMessageKey, withoutRunningTurn } from "@/lib/turn-idempotency";
import { finalReply } from "@/lib/turn-reply";
import { visibleHistory } from "@/lib/compaction";
import { attachedFiles, cleanUserMessage } from "@/lib/chat-errors";
import { useTurnReporter } from "@/components/activity/hooks";
import { FILES_ONLY_PROMPT, type SessionDetail } from "@/lib/types";
import { uid, type ChatMessage, type ChatSettings, type MessageAttachment, type ToolEvent, type ToolStatus } from "./types";
import { toMs } from "@/lib/activity";
import { frameBatch } from "@/lib/frame-batch";

export interface SendSettings extends Partial<ChatSettings> {
  files?: string[];
  // Display metadata for the same files (name/path/isImage) — rendered as chips in the user bubble.
  attachments?: MessageAttachment[];
}

interface UseChatArgs {
  agentId: string;
  // The expert's Hermes profile, or null for the instance's default home. Sent on every turn and
  // on every session read: the instance does not remember it per session.
  profile: string | null;
  sessionId: string | null;
  // Bumped by the provider when the instance reports new activity on this thread: re-read it.
  refreshToken?: number;
  // Called once when a brand-new conversation mints its session id mid-stream. The provider
  // records the rail row; `promote` says whether to also make it the open thread (false when the
  // user has already moved on and the run is finishing in the background).
  onSessionCreated: (sessionId: string, title: string, opts?: { promote?: boolean }) => void;
  // Called when an existing thread gets a new turn, so the rail can bubble it to the top.
  onActivity?: (sessionId: string) => void;
}

// Parse a fetch SSE stream into (event, data) pairs. Handles CRLF, multi-line data, and
// `:keepalive` comment lines. There is no [DONE] sentinel — the stream just ends.
async function readSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: Record<string, unknown>) => void,
  signal: AbortSignal
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        let event = "message";
        const dataLines: string[] = [];
        for (const line of block.split("\n")) {
          if (!line || line.startsWith(":")) continue; // blank or keepalive comment
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;

        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
        } catch {
          data = {};
        }
        onEvent(event, data);
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

// The browser's word on the network, read when a request fails (true where it cannot tell).
const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

// A call the model is still writing is replaced by its start, which carries the arguments.
function openTool(tools: ToolEvent[] | undefined, call: ToolEvent): ToolEvent[] {
  const list = tools ?? [];
  const last = list[list.length - 1];
  if (last?.generating && last.tool === call.tool) return [...list.slice(0, -1), call];
  return [...list, call];
}

// Mark the most recent running tool of a given name as completed/failed.
function closeTool(tools: ToolEvent[] | undefined, name: string | undefined, status: ToolStatus, durationMs?: number): ToolEvent[] {
  const next = [...(tools ?? [])];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].tool === name && next[i].status === "running") {
      next[i] = { ...next[i], status, durationMs };
      return next;
    }
  }
  return next;
}

// A turn in flight (or just finished). Runs live in a session-keyed registry rather than in the
// React tree, so switching threads never cancels them: the stream keeps consuming in the
// background, and the run's bubbles are re-merged into view when the user returns to the thread.
interface LiveRun {
  /** null until response.created mints a session id (brand-new chat). */
  sessionId: string | null;
  responseId: string | null;
  abort: AbortController;
  /** The user bubbles of this turn (several when queued messages went out together); empty for a
   *  reattached run, whose transcript supplies them once the turn ends. */
  users: ChatMessage[];
  /** Latest immutable snapshot of the assistant bubble — updated via patchRun. */
  assistant: ChatMessage;
  done: boolean;
  /** Messages steered into this turn (in flight or accepted), shown before the reply they join. */
  steered: Queued[];
  /** Steer requests still in flight: the turn's end waits for them before dispatching the queue. */
  steers: Set<Promise<void>>;
  /** Messages the turn could not take, sent together as the next turn on the same session. */
  queue: Queued[];
  /** What was sent, as the engine stores it (absent for a reattached run). */
  sent?: { role: "user"; content: string; at: number };
  /** The text written before each tool: a step, taken out of the reply. */
  narration: string[];
  /** Where this turn's wait went (absent for a reattached run): see lib/chat-timing. */
  timing?: TurnTiming;
  model?: string | null;
}

interface Queued {
  user: ChatMessage;
  settings: SendSettings;
}

// A turn that just ended can still hold the session for a moment (409 session_busy): wait it out.
const BUSY_RETRIES = 20;
const BUSY_WAIT_MS = 3000;

// --- Transcript merging ------------------------------------------------------------------------

function mapHistory(history: SessionDetail["history"]): ChatMessage[] {
  // A message the runtime sent again with its continuation order is the member's once: the copy goes.
  const rows = visibleHistory(history ?? []).filter((h, i, all) => {
    if (h.role !== "user" || i === 0) return true;
    const own = cleanUserMessage(steerText(h.content ?? ""));
    const prev = all[i - 1];
    return !(own !== steerText(h.content ?? "").trim() && prev.role === "user" && cleanUserMessage(steerText(prev.content ?? "")) === own);
  });
  return rows.map((h) => {
    // The files of a member's turn come back inside its text: shown as chips, as when it was sent.
    const sent = h.role === "user" ? attachedFiles(cleanUserMessage(steerText(h.content ?? ""))) : null;
    return {
      id: h.id || uid("h"),
      role: h.role,
      content: sent ? (sent.files.length && sent.text === FILES_ONLY_PROMPT ? "" : sent.text) : (h.content ?? ""),
      ...(sent?.files.length ? { attachments: sent.files } : {}),
      thinking: h.thinking,
      ...(h.files?.length ? { files: h.files } : {}),
      ...(h.created_at ? { at: toMs(h.created_at) } : {}),
      ...(h.role === "user" && isSteer(h.content ?? "") ? { steered: true } : {}),
    };
  });
}

// Overlay a live run's bubbles onto the fetched transcript, minus what Hermes already saved of the
// running turn (it writes as it goes); once the run is done, the transcript holds the whole turn and wins.
function mergeLiveRun(history: ChatMessage[], run: LiveRun): ChatMessage[] {
  if (run.done) return history;
  return [...withoutRunningTurn(history, run.sent), ...run.users, ...run.steered.map((q) => q.user), run.assistant, ...run.queue.map((q) => q.user)];
}

// A request cut before any answer is sent again with the same key: the gateway joins the turn it started.
const RESEND_WAITS_MS = [1_500, 4_000];

// The steers Hermes left unread: their own bubbles when they match, else one bubble with its text.
function takeUnread(run: LiveRun, pending: string): Queued[] {
  const n = unreadSteerCount(run.steered.map((q) => q.user.content), pending);
  if (n) return run.steered.splice(-n);
  const settings = run.steered[run.steered.length - 1]?.settings ?? {};
  return [{ user: { id: uid("u"), role: "user", content: pending.trim() }, settings }];
}

// One thread's history as last read in this tab. The instance belongs to one member, so its id
// carries the user.
const historyKey = (agentId: string, q: string, sessionId: string) => `chat:${agentId}${q}:${sessionId}`;

export function useChat({ agentId, profile, sessionId, refreshToken = 0, onSessionCreated, onActivity }: UseChatArgs) {
  const q = profileQuery(profile);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The connection back: the « no Internet » line goes, the member writes again.
  useEffect(() => {
    const back = () => setError((e) => (e === OFFLINE ? null : e));
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, []);
  // Tells the app-wide tracker when a turn starts and ends, for the notifications.
  const turns = useTurnReporter(agentId, profile);

  // Turns in flight (or recently finished), keyed by session id. The registry outlives thread
  // switches, so a started response always runs to completion and is re-merged on return.
  const runsRef = useRef<Map<string, LiveRun>>(new Map());
  // The run started from the New Chat view, until response.created mints its session id (or the
  // user leaves the view, which unbinds it — the run itself keeps going).
  const newChatRunRef = useRef<LiveRun | null>(null);
  const activeSessionRef = useRef<string | null>(sessionId);
  // Set just before we promote a freshly-created session, so the load effect doesn't clobber
  // the in-flight stream with a history fetch when `sessionId` flips to the new id.
  const skipLoadRef = useRef<string | null>(null);
  // Starts a turn; behind a ref because consume() (defined first) dispatches the queue with it.
  const startTurnRef = useRef<(sessionId: string | null, batch: Queued[]) => void>(() => {});

  // Latest provider callbacks behind stable refs, so the long-lived stream consumers and the
  // load effect don't churn identity when the provider re-renders (e.g. on tab flips).
  const onSessionCreatedRef = useRef(onSessionCreated);
  onSessionCreatedRef.current = onSessionCreated;
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;

  // Whether this run's thread is the one on screen — only then do its patches hit React state.
  const isViewed = useCallback((run: LiveRun) => {
    return run.sessionId ? activeSessionRef.current === run.sessionId : newChatRunRef.current === run;
  }, []);

  // The on-screen snapshots of the live runs, one state update per frame however many deltas arrive.
  const [frames] = useState(() =>
    frameBatch<LiveRun, ChatMessage>((pending) => {
      const shown = [...pending].filter(([run]) => isViewed(run)).map(([, snapshot]) => snapshot);
      if (!shown.length) return;
      setMessages((prev) => {
        let next = prev;
        for (const snapshot of shown) {
          const i = prev.findLastIndex((m) => m.id === snapshot.id);
          if (i < 0) continue;
          if (next === prev) next = [...prev];
          next[i] = snapshot;
        }
        return next;
      });
    })
  );
  useEffect(() => () => frames.cancel(), [frames]);

  // Update a run's assistant snapshot, and mirror it into the visible messages when its thread
  // is on screen. Backgrounded runs just accumulate — re-merged when the user returns.
  const patchRun = useCallback(
    (run: LiveRun, fn: (m: ChatMessage) => ChatMessage) => {
      run.assistant = fn(run.assistant);
      if (isViewed(run)) frames.push(run, run.assistant);
    },
    [isViewed, frames]
  );

  // Drop a run everywhere: registry and new-chat binding.
  const forgetRun = useCallback((run: LiveRun) => {
    if (run.sessionId && runsRef.current.get(run.sessionId) === run) {
      runsRef.current.delete(run.sessionId);
    }
    if (newChatRunRef.current === run) newChatRunRef.current = null;
  }, []);

  // Cancel a turn upstream so the agent actually stops working — dropping the local SSE alone
  // does NOT stop server-side generation (only the cancel endpoint does).
  const cancelUpstream = useCallback(
    (rid: string | null) => {
      if (rid) apiFetch(`/api/agents/${agentId}/chat/responses/${rid}/cancel`, { method: "POST" }).catch(() => {});
    },
    [agentId]
  );

  // Re-pull the transcript for the on-screen thread (used when a reattached turn ends — the
  // persisted transcript supplies the full pair, including the user row the reattach lacked).
  const refreshHistory = useCallback(
    async (sid: string) => {
      try {
        const res = await apiFetch<SessionDetail>(`/api/agents/${agentId}/chat/sessions/${sid}${q}`);
        const history = remember(historyKey(agentId, q, sid), mapHistory(res.history));
        if (activeSessionRef.current !== sid || runsRef.current.get(sid)) return;
        setMessages(history);
        setIsStreaming(false);
      } catch {
        // Leave whatever's on screen.
      }
    },
    [agentId, q]
  );

  // Activity from another channel (Telegram, a routine…) on the open thread; skipped mid-turn.
  useEffect(() => {
    if (refreshToken && sessionId) void refreshHistory(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  // Drain a turn's SSE stream into its run. Shared by send() and reattach; runs to completion
  // even when the thread is backgrounded — only the on-screen mirroring is gated.
  const consume = useCallback(
    async (run: LiveRun, body: ReadableStream<Uint8Array>) => {
      let streamError: string | null = null;
      let sawTerminal = false;
      let pendingSteer = "";
      try {
        await readSSE(
          body,
          (event, data) => {
            switch (event) {
              case "response.created": {
                if (run.timing) mark(run.timing, "created", performance.now());
                run.responseId = str(data.id) ?? run.responseId;
                const sid = str(data.session_id);
                if (!run.sessionId && sid) {
                  // Brand-new chat: file the run under its minted session. Only promote it to
                  // the open thread if the user is still on the New Chat view it started from.
                  run.sessionId = sid;
                  runsRef.current.set(sid, run);
                  const promote = newChatRunRef.current === run;
                  if (promote) {
                    newChatRunRef.current = null;
                    activeSessionRef.current = sid;
                    skipLoadRef.current = sid;
                  }
                  onSessionCreatedRef.current(sid, run.users[0]?.content.slice(0, 80) ?? "New chat", { promote });
                }
                turns.bind(run);
                break;
              }
              case "response.reasoning.delta": {
                if (run.timing) mark(run.timing, "first", performance.now());
                const t = str(data.text);
                if (t) patchRun(run, (m) => ({ ...m, thinking: (m.thinking ?? "") + t }));
                break;
              }
              case "response.output_text.delta": {
                if (run.timing) mark(run.timing, "first", performance.now());
                const t = str(data.text);
                if (t) patchRun(run, (m) => ({ ...m, content: m.content + t }));
                break;
              }
              case "response.tool_call.generating":
              case "response.tool_call.started": {
                const tool = str(data.tool) ?? "tool";
                const args = data.arguments && typeof data.arguments === "object" ? (data.arguments as Record<string, unknown>) : undefined;
                const generating = event === "response.tool_call.generating";
                if (run.timing) {
                  mark(run.timing, "first", performance.now());
                  if (!generating) run.timing.tools += 1;
                }
                const said = run.assistant.content.trim();
                if (said) run.narration.push(said);
                patchRun(run, (m) => ({ ...m, content: "", tools: openTool(m.tools, { tool, status: "running", phrase: toolPhrase(tool, args), generating }) }));
                break;
              }
              case "response.tool_call.completed":
                patchRun(run, (m) => ({
                  ...m,
                  tools: closeTool(m.tools, str(data.tool) ?? "tool", "completed", typeof data.duration_ms === "number" ? data.duration_ms : undefined),
                }));
                break;
              case "response.tool_call.failed":
                patchRun(run, (m) => ({ ...m, tools: closeTool(m.tools, str(data.tool) ?? "tool", "error") }));
                break;
              case "response.completed": {
                sawTerminal = true;
                const final = str(data.output_text);
                if (final) patchRun(run, (m) => ({ ...m, content: finalReply(final, run.narration) }));
                pendingSteer = str(data.pending_steer) ?? "";
                break;
              }
              case "response.failed": {
                sawTerminal = true;
                const err = data.error as { message?: string } | undefined;
                // The instance's own reason is technical and in English: it stays in the browser console.
                if (err?.message) console.error("[chat] response.failed:", err.message);
                streamError = chatFailureMessage(err?.message, "Votre expert n’a pas pu répondre. Réessayez dans un instant.", isOnline());
                break;
              }
            }
          },
          run.abort.signal
        );
      } finally {
        // A steer answered "not accepted" joins the queue: wait for the answers before reading it.
        while (run.steers.size) await Promise.allSettled([...run.steers]);
        run.done = true;
        // No terminal event: the turn may still run upstream, the tracker follows it (no-op once stopped).
        if (sawTerminal) {
          turns.end(run, streamError ? "failed" : "completed", streamError ?? undefined);
          reportTiming(run, profile, streamError ? "failed" : "completed");
        }
        else turns.detach(run);
        // Sweep any still-running tool spinners, and put a failure into the bubble itself so it
        // shows wherever the thread is next viewed — covers terminal events and a bare stream-end.
        patchRun(run, (m) => ({
          ...m,
          content: m.content || (streamError ? `_${streamError}_` : ""),
          tools: (m.tools ?? []).map((t) => (t.status === "running" ? { ...t, status: "completed" as const } : t)),
        }));
        // The end shows at once, before the streaming flag drops.
        frames.flush();
        // The queued messages go out together on the same session — unless the user stopped or
        // deleted the thread. A stream that died without a terminal event may leave the session
        // busy a while longer; startTurn waits out the 409.
        // Steers Hermes did not read (pending_steer) lead the next turn, ahead of the queue.
        const unread = pendingSteer ? takeUnread(run, pendingSteer) : [];
        const next = !run.abort.signal.aborted && run.sessionId ? [...unread, ...run.queue.splice(0)] : [];
        if (!sawTerminal && !run.abort.signal.aborted) {
          // The stream died without a terminal event — the turn may still be running server-side.
          // Drop the in-memory run: the next visit to the thread reads the session's
          // active_response_id and reattaches if the turn is still going.
          forgetRun(run);
        }
        if (isViewed(run)) {
          if (!next.length) setIsStreaming(false);
          if (streamError) setError(streamError);
          if (sawTerminal && run.users.length === 0 && run.sessionId) {
            // A reattached run has no user bubble; the turn just persisted, so swap the live
            // bubbles for the transcript's full pair.
            forgetRun(run);
            void refreshHistory(run.sessionId);
          }
        }
        if (next.length) startTurnRef.current(run.sessionId, next);
      }
    },
    [patchRun, isViewed, forgetRun, refreshHistory, turns, profile, frames]
  );

  // Reattach to a turn that outlived this component (page reload / workspace re-entry): register
  // a synthetic run and replay its stream — the gateway replays every event from response.created
  // onward, then stays live. Returns the run so the caller can merge it right away.
  const startReattach = useCallback(
    (sid: string, responseId: string): LiveRun => {
      const run: LiveRun = {
        sessionId: sid,
        responseId,
        abort: new AbortController(),
        users: [],
        assistant: { id: uid("a"), role: "assistant", content: "", tools: [] },
        done: false,
        steered: [],
        steers: new Set(),
        queue: [],
        narration: [],
      };
      turns.start(run);
      runsRef.current.set(sid, run);
      void (async () => {
        let attached = false;
        try {
          const res = await fetch(`/api/agents/${agentId}/chat/responses/${encodeURIComponent(responseId)}/stream`, {
            signal: run.abort.signal,
          });
          if (!res.ok || !res.body) {
            // Gone (expired or a gateway restart) or transient — either way the transcript is
            // the best available view; a turn that is still running is rediscovered from
            // active_response_id on the next visit.
            turns.detach(run);
            run.done = true;
            forgetRun(run);
            void refreshHistory(sid);
            return;
          }
          attached = true;
          await consume(run, res.body);
        } catch (e) {
          turns.detach(run);
          run.done = true;
          forgetRun(run);
          if ((e as Error).name === "AbortError") return;
          // If it broke before attaching, nothing streamed into the bubble yet: fall back to the
          // transcript; a mid-replay drop keeps the partial on screen (consume already settled it).
          if (!attached) void refreshHistory(sid);
        }
      })();
      return run;
    },
    [agentId, consume, refreshHistory, forgetRun, turns]
  );

  // Stop any turn on a thread, locally and upstream — used when the thread itself is deleted.
  // With no in-memory run (e.g. after a reload), the session's active_response_id names the
  // response to cancel; cancelling an already-finished response is a no-op 200 upstream.
  const killRun = useCallback(
    (sid: string) => {
      const run = runsRef.current.get(sid);
      if (run && !run.done) {
        run.done = true;
        run.abort.abort();
        cancelUpstream(run.responseId);
        runsRef.current.delete(sid);
        turns.cancel(run);
      } else if (!run) {
        apiFetch<SessionDetail>(`/api/agents/${agentId}/chat/sessions/${sid}${q}`)
          .then((res) => cancelUpstream(res.active_response_id ?? null))
          .catch(() => {});
      }
    },
    [agentId, q, cancelUpstream, turns]
  );

  // Load history when the selected thread changes; reset for a fresh chat. Switching threads no
  // longer cancels an in-flight turn — the run keeps streaming in the background and both answers
  // land; only the explicit Stop button (or deleting the thread) cancels upstream.
  useEffect(() => {
    activeSessionRef.current = sessionId;

    // `null` is both skipLoadRef's "unset" sentinel AND the New Chat sessionId; guard against
    // null so the New Chat transition (sessionId -> null) is NOT swallowed here and falls
    // through to clear messages below.
    if (skipLoadRef.current !== null && skipLoadRef.current === sessionId) {
      skipLoadRef.current = null;
      return; // we just created this session mid-stream — keep the live messages
    }

    // Leaving the New Chat view unbinds any pre-creation run (it keeps going; response.created
    // will file it under its minted session without promoting it).
    newChatRunRef.current = null;
    setError(null);

    if (!sessionId) {
      setMessages([]);
      setIsStreaming(false);
      return;
    }

    const liveNow = runsRef.current.get(sessionId);
    setIsStreaming(!!liveNow && !liveNow.done);

    let cancelled = false;
    // A thread read before shows at once, as it was; the fresh read replaces it behind.
    const kept = liveNow ? undefined : cached<ChatMessage[]>(historyKey(agentId, q, sessionId));
    if (kept) setMessages(kept);
    setLoadingHistory(!kept);
    apiFetch<SessionDetail>(`/api/agents/${agentId}/chat/sessions/${sessionId}${q}`)
      .then((res) => {
        if (cancelled) return;
        const history = remember(historyKey(agentId, q, sessionId), mapHistory(res.history));

        let run = runsRef.current.get(sessionId) ?? null;
        if (!run && res.active_response_id) {
          // A turn outlived this component (reload / workspace re-entry, any device): the
          // session names its running response — reattach and stream the rest of it live.
          run = startReattach(sessionId, res.active_response_id);
        }

        if (run) {
          if (run.done) {
            forgetRun(run);
            // The turn finished while this fetch was in flight: a snapshot that still names
            // this run as active predates the turn's persist, so its history lacks the turn —
            // keep the run's bubbles (or refetch when a reattached run has no user bubble).
            if (res.active_response_id === run.responseId) {
              if (run.users.length) {
                setMessages([...history, ...run.users, ...run.steered.map((q) => q.user), run.assistant]);
              } else {
                setMessages(history);
                void refreshHistory(sessionId);
              }
              setIsStreaming(false);
              return;
            }
          }
          setMessages(mergeLiveRun(history, run));
          setIsStreaming(!run.done);
        } else {
          setMessages(history);
          setIsStreaming(false);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(chatFailureMessage((e as Error).message, (e as Error).message, isOnline()));
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agentId, q, sessionId, startReattach, forgetRun, refreshHistory]);

  // One turn on a session: its bubbles (queued ones lose their "en attente" mark), then the stream.
  // Several queued messages make one turn, their texts joined and their files merged.
  const startTurn = useCallback(
    async (sessionId: string | null, batch: Queued[]) => {
      const settings = batch[batch.length - 1].settings;
      const { text, files } = batchQueued(batch.map((q) => ({ text: q.user.content, files: q.settings.files ?? [] })));
      const startedAt = Date.now();
      const users = batch.map((q): ChatMessage => ({ ...q.user, at: startedAt, queued: undefined, steered: undefined }));
      const assistant: ChatMessage = { id: uid("a"), role: "assistant", content: "", tools: [] };
      const run: LiveRun = { sessionId, responseId: null, abort: new AbortController(), users, assistant, done: false, steered: [], steers: new Set(), queue: [], sent: { role: "user", content: text, at: startedAt }, narration: [], timing: startTiming(performance.now()), model: settings.model ?? null };
      turns.start(run);
      if (sessionId) {
        runsRef.current.set(sessionId, run);
        // Bubble an existing thread to the top of the rail as soon as it gets a new turn.
        onActivityRef.current?.(sessionId);
      } else {
        newChatRunRef.current = run;
      }
      if (isViewed(run)) {
        const ids = new Set(users.map((m) => m.id));
        setMessages((prev) => [...prev.filter((m) => !ids.has(m.id)), ...users, assistant]);
        setIsStreaming(true);
      }

      try {
        const body = JSON.stringify({
          input: text,
          profile: profile ?? undefined,
          session_id: sessionId ?? undefined,
          model: settings.model ?? undefined,
          provider: settings.provider ?? undefined,
          reasoning_effort: settings.reasoningEffort ?? undefined,
          files: files.length ? files : undefined,
          client_message_id: newMessageKey(),
        });
        let res: Response;
        for (let attempt = 0, resend = 0; ; attempt++) {
          try {
            res = await fetch(`/api/agents/${agentId}/chat/responses`, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: run.abort.signal });
          } catch (e) {
            if (!isNetworkError(e) || resend >= RESEND_WAITS_MS.length) throw e;
            await new Promise((r) => setTimeout(r, RESEND_WAITS_MS[resend++]));
            if (run.abort.signal.aborted) throw new DOMException("Arrêté", "AbortError");
            continue;
          }
          if (res.status !== 409 || attempt >= BUSY_RETRIES) break;
          await new Promise((r) => setTimeout(r, BUSY_WAIT_MS));
          if (run.abort.signal.aborted) throw new DOMException("Arrêté", "AbortError");
        }

        if (run.timing) mark(run.timing, "accepted", performance.now());
        if (!res.ok || !res.body) {
          if (res.status === 409) {
            throw new Error("Votre expert termine sa réponse précédente. Patientez un instant, puis réessayez.");
          }
          throw new Error(await readApiError(res, "Le message n’a pas pu être envoyé"));
        }

        await consume(run, res.body);
      } catch (e) {
        run.done = true;
        const viewed = isViewed(run);
        // Drop the in-memory run: if only the local stream died (not the turn), revisiting the
        // thread rediscovers it from the session's active_response_id and reattaches.
        forgetRun(run);
        const aborted = (e as Error).name === "AbortError";
        if (!aborted) {
          turns.end(run, "failed", chatFailureMessage((e as Error).message, "", isOnline()));
          reportTiming(run, profile, "failed");
        }
        const next = !aborted && run.sessionId ? run.queue.splice(0) : [];
        // consume() may already have handed the queue to a newer turn: leave its state alone.
        const current = run.sessionId ? runsRef.current.get(run.sessionId) : newChatRunRef.current;
        if (viewed && !(current && current !== run && !current.done)) {
          if (!next.length) setIsStreaming(false);
          if (!aborted) setError(chatFailureMessage((e as Error).message, (e as Error).message || "Une erreur est survenue. Réessayez dans un instant.", isOnline()));
        }
        if (next.length) void startTurnRef.current(run.sessionId, next);
      }
    },
    [agentId, profile, consume, isViewed, forgetRun, turns]
  );
  startTurnRef.current = startTurn;

  // Like Telegram: a message sent while the expert answers shows at once and joins its turn (steer).
  // Files, an older image or a turn that just ended: it waits and goes out as the next turn instead.
  const steer = useCallback(
    (run: LiveRun, item: Queued) => {
      run.steered.push(item);
      const toQueue = () => {
        run.steered = run.steered.filter((q) => q !== item);
        const queued = { ...item.user, queued: true, steered: false };
        run.queue.push({ ...item, user: queued });
        // Not part of this reply after all: it waits after it, as the next turn.
        if (isViewed(run)) setMessages((prev) => [...prev.filter((m) => m.id !== queued.id), queued]);
      };
      const body = JSON.stringify({ text: item.user.content, client_message_id: newMessageKey() });
      const post = () => apiFetch<{ accepted?: boolean }>(`/api/agents/${agentId}/chat/responses/${run.responseId}/steer`, { method: "POST", body });
      // Sent again once if the answer was lost: the gateway answers a resent steer without adding it twice.
      const p = post()
        .catch((e: unknown) => (isNetworkError(e) ? new Promise((r) => setTimeout(r, RESEND_WAITS_MS[0])).then(post) : Promise.reject(e)))
        .then((r) => r.accepted === true, () => false)
        .then((accepted) => {
          if (!accepted) toQueue();
        })
        .finally(() => run.steers.delete(p));
      run.steers.add(p);
    },
    [agentId, isViewed]
  );

  const send = useCallback(
    (text: string, settings: SendSettings = {}) => {
      const trimmed = text.trim();
      if (!trimmed && !(settings.files ?? []).length) return;
      const user: ChatMessage = {
        id: uid("u"),
        role: "user",
        content: trimmed,
        attachments: settings.attachments?.length ? settings.attachments : undefined,
      };
      const live = activeSessionRef.current ? runsRef.current.get(activeSessionRef.current) : newChatRunRef.current;
      if (live && !live.done) {
        if (live.responseId && !(settings.files ?? []).length && !live.queue.length) {
          const added = { ...user, steered: true };
          setMessages((prev) => insertBefore(prev, live.assistant.id, added));
          steer(live, { user: added, settings });
          return;
        }
        const queued = { ...user, queued: true };
        live.queue.push({ user: queued, settings });
        setMessages((prev) => [...prev, queued]);
        return;
      }
      setError(null);
      void startTurn(activeSessionRef.current, [{ user, settings }]);
    },
    [startTurn, steer]
  );

  // Stop the current turn: abort the local stream and cancel it upstream so the agent stops work.
  const stop = useCallback(() => {
    const run = activeSessionRef.current ? runsRef.current.get(activeSessionRef.current) : newChatRunRef.current;
    if (run && !run.done) {
      // Stop ends the whole burst: the messages still waiting are dropped with the turn.
      run.queue.length = 0;
      run.done = true;
      run.abort.abort();
      cancelUpstream(run.responseId);
      forgetRun(run);
      turns.cancel(run);
    }
    setMessages((prev) => (prev.some((m) => m.queued) ? prev.filter((m) => !m.queued) : prev));
    setIsStreaming(false);
  }, [cancelUpstream, forgetRun, turns]);

  // A message waiting for the reply in progress has not left yet: the member may take it back.
  const unqueue = useCallback((id: string) => {
    for (const run of [newChatRunRef.current, ...runsRef.current.values()]) {
      if (!run) continue;
      const i = run.queue.findIndex((q) => q.user.id === id);
      if (i >= 0) run.queue.splice(i, 1);
    }
    setMessages((prev) => prev.filter((m) => !(m.queued && m.id === id)));
  }, []);

  // On unmount, close the local streams only — the turns keep running server-side, and the next
  // mount (reload, workspace re-entry) reattaches via the session's active_response_id.
  useEffect(() => {
    const runs = runsRef.current;
    return () => {
      // The tracker keeps following the turns that are still running.
      for (const run of runs.values()) {
        if (!run.done) turns.detach(run);
        run.abort.abort();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const fresh = newChatRunRef.current;
      if (fresh) turns.detach(fresh);
      fresh?.abort.abort();
    };
  }, []);

  return { messages, isStreaming, loadingHistory, error, send, stop, killRun, unqueue };
}

// The turn's times go to the host's logs (one line, see /api/metrics/chat) and stay in this
// browser, the last 50, under `yelema:latence`. Once per turn; never in the member's way.
const TIMING_STORE = "yelema:latence";
function reportTiming(run: LiveRun, profile: string | null, outcome: "completed" | "failed") {
  const t = run.timing;
  if (!t) return;
  run.timing = undefined;
  const record = finishTiming(t, performance.now(), { at: new Date(), profile, model: run.model ?? null, outcome });
  try {
    const kept = JSON.parse(localStorage.getItem(TIMING_STORE) ?? "[]");
    localStorage.setItem(TIMING_STORE, JSON.stringify(keepLast(Array.isArray(kept) ? kept : [], record)));
  } catch {
    // Private window or full storage: the server's line is enough.
  }
  try {
    const body = new Blob([JSON.stringify(record)], { type: "application/json" });
    if (!navigator.sendBeacon?.("/api/metrics/chat", body)) {
      void fetch("/api/metrics/chat", { method: "POST", body, keepalive: true }).catch(() => {});
    }
  } catch {
    // Measuring must never break a chat.
  }
}
