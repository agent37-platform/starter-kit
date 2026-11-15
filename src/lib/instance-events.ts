// The instance's event stream (yelema-platform runtime gateway, `GET /v1/instances/{id}/events`), heard by
// one EventSource per tab: a turn ended, the drive changed, the instance's state changed. No content, only
// the kind. Off (EVENT_STREAM unset) or disconnected, every poll runs as before. Pure, so the rules are tested.

export const INSTANCE_EVENTS = ["turn.ended", "files.changed", "instance.changed"] as const;
export type InstanceEventType = (typeof INSTANCE_EVENTS)[number];

const FIRST_RETRY_MS = 2_000;
const MAX_RETRY_MS = 5 * 60_000;

/** Wait before reconnect attempt `n` (0-based): doubles up to 5 min, ±20 % so tabs do not come back together. */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(FIRST_RETRY_MS * 2 ** Math.max(0, attempt), MAX_RETRY_MS);
  return Math.round(base * (0.8 + 0.4 * random()));
}

/** EVENT_STREAM (or NEXT_PUBLIC_EVENT_STREAM) "on", and the gateway the stream comes from. */
export function eventStreamOn(env: Record<string, string | undefined>): boolean {
  const flag = (env.EVENT_STREAM ?? env.NEXT_PUBLIC_EVENT_STREAM)?.trim().toLowerCase();
  return flag === "on" && Boolean(env.RUNTIME_GATEWAY_URL?.trim() && env.RUNTIME_GATEWAY_TOKEN?.trim());
}

type Listener = (type: InstanceEventType) => void;

export function createEventHub() {
  const listeners = new Map<string, Set<Listener>>();
  const live = new Set<string>();
  return {
    on(agentId: string, fn: Listener): () => void {
      const set = listeners.get(agentId) ?? new Set<Listener>();
      set.add(fn);
      listeners.set(agentId, set);
      return () => void set.delete(fn);
    },
    emit(agentId: string, type: InstanceEventType): void {
      for (const fn of [...(listeners.get(agentId) ?? [])]) fn(type);
    },
    setConnected(agentId: string, on: boolean): void {
      if (on) live.add(agentId);
      else live.delete(agentId);
    },
    /** The stream is up for this instance: polls may wait for it, at their longest delay. */
    connected: (agentId: string): boolean => live.has(agentId),
  };
}

export type EventHub = ReturnType<typeof createEventHub>;

/** A poll's turn: always without the stream; with it, only as a safety net once `safetyMs` passed without a reading. */
export const pollDue = (connected: boolean, sinceLastMs: number, safetyMs = 30_000): boolean => !connected || sinceLastMs >= safetyMs;

/** Resolves on the next `type` event of the instance, or when `signal` aborts. */
export function nextEvent(hub: EventHub, agentId: string, type: InstanceEventType, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const off = hub.on(agentId, (t) => t === type && done());
    const done = () => (off(), signal.removeEventListener("abort", done), resolve());
    signal.addEventListener("abort", done, { once: true });
  });
}

/** The tab's one hub. */
export const instanceEvents = createEventHub();
