import { finalizeEvent, type Event, type EventTemplate } from "nostr-tools/pure";

// The client's own messaging relay (Buzz, a Nostr relay; one per client, run by the back office).
// It refuses any request before NIP-42 authentication, so this connection authenticates FIRST, then
// queries, subscribes and publishes. Only the signing comes from nostr-tools; the key stays in the
// browser (see buzz-keys.ts). Event shapes follow Buzz: messages are kind 9 with an `h` channel tag.

export type Filter = Record<string, unknown>;
type Pending = { resolve: (v: { ok: boolean; message: string }) => void; timer: ReturnType<typeof setTimeout> };
type Query = { events: Event[]; resolve: (events: Event[]) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; live?: (e: Event) => void };
export type Subscription = { close: () => void };

export const MESSAGE_KINDS = [9, 40002, 40008, 45001, 45003];
const TIMEOUT_MS = 15_000;

export class BuzzConnection {
  private ws: WebSocket | null = null;
  private serial = 0;
  private publishes = new Map<string, Pending>();
  private queries = new Map<string, Query>();
  onclose: (() => void) | null = null;
  private readonly url: string;
  private readonly secret: Uint8Array;

  constructor(url: string, secret: Uint8Array) {
    this.url = url;
    this.secret = secret;
  }

  /** Opens the socket and answers the relay's AUTH challenge; resolves once the relay accepts it. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const fail = setTimeout(() => reject(new Error("Le relais ne répond pas.")), TIMEOUT_MS);
      let authId: string | null = null;
      ws.onmessage = (m) => {
        let data: unknown[];
        try {
          data = JSON.parse(String(m.data)) as unknown[];
        } catch {
          return;
        }
        if (data[0] === "AUTH" && typeof data[1] === "string") {
          const auth = this.sign({ kind: 22242, created_at: now(), tags: [["relay", this.url], ["challenge", data[1]]], content: "" });
          authId = auth.id;
          ws.send(JSON.stringify(["AUTH", auth]));
          return;
        }
        if (data[0] === "OK" && data[1] === authId) {
          clearTimeout(fail);
          return data[2] === true ? resolve() : reject(new Error(`Connexion refusée par le relais : ${String(data[3] ?? "")}`));
        }
        this.dispatch(data);
      };
      ws.onerror = () => reject(new Error("Le relais est injoignable."));
      ws.onclose = () => {
        clearTimeout(fail);
        reject(new Error("Le relais est injoignable."));
        this.drop();
      };
    });
  }

  close(): void {
    this.onclose = null;
    this.drop();
  }

  /**
   * The socket is gone, or silent (the relay drops a connection whose pongs stop arriving, and the close
   * does not always reach the browser): everything pending fails now, and `onclose` lets the owner reopen.
   */
  private drop(): void {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.onclose = ws.onmessage = ws.onerror = null;
    if (ws.readyState <= WebSocket.OPEN) ws.close();
    for (const q of this.queries.values()) (clearTimeout(q.timer), q.reject(new Error("Connexion au relais perdue.")));
    this.queries.clear();
    for (const p of this.publishes.values()) (clearTimeout(p.timer), p.resolve({ ok: false, message: "Connexion au relais perdue." }));
    this.publishes.clear();
    this.onclose?.();
  }

  sign(template: EventTemplate): Event {
    return finalizeEvent(template, this.secret);
  }

  /** Every stored event matching `filter`, up to the relay's end-of-stored-events. */
  query(filter: Filter): Promise<Event[]> {
    return this.req(filter);
  }

  /**
   * One REQ kept open after EOSE: stored events, then every new one, all through `onEvent`. `onStored` fires at
   * EOSE; `onError` only before it (a silent relay is dropped like a query; afterwards `onclose` covers it).
   */
  subscribe(filter: Filter, onEvent: (e: Event) => void, on: { onStored?: () => void; onError?: (e: Error) => void } = {}): Subscription {
    const id = `s${++this.serial}`;
    const timer = setTimeout(() => {
      if (!this.queries.has(id)) return;
      this.queries.delete(id);
      on.onError?.(new Error("Le relais ne répond pas."));
      this.drop();
    }, TIMEOUT_MS);
    this.queries.set(id, { events: [], resolve: () => on.onStored?.(), reject: (e) => on.onError?.(e), timer, live: onEvent });
    this.send(["REQ", id, filter]);
    return { close: () => (clearTimeout(timer), this.queries.delete(id) && this.send(["CLOSE", id])) };
  }

  /** Signs and sends; resolves with the relay's verdict (`message` carries Buzz's `response:{…}`). */
  publish(template: EventTemplate): Promise<{ ok: boolean; message: string; id: string }> {
    const event = this.sign(template);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.publishes.delete(event.id);
        resolve({ ok: false, message: "Le relais ne répond pas.", id: event.id });
        this.drop();
      }, TIMEOUT_MS);
      this.publishes.set(event.id, { resolve: (v) => resolve({ ...v, id: event.id }), timer });
      this.send(["EVENT", event]);
    });
  }

  private req(filter: Filter): Promise<Event[]> {
    const id = `q${++this.serial}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.queries.delete(id);
        reject(new Error("Le relais ne répond pas."));
        this.drop();
      }, TIMEOUT_MS);
      this.queries.set(id, { events: [], resolve, reject, timer });
      this.send(["REQ", id, filter]);
    });
  }

  private send(message: unknown[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private dispatch(data: unknown[]): void {
    const [type, id] = data;
    if (typeof id !== "string") return;
    if (type === "OK") {
      const p = this.publishes.get(id);
      if (!p) return;
      clearTimeout(p.timer);
      this.publishes.delete(id);
      p.resolve({ ok: data[2] === true, message: String(data[3] ?? "") });
      return;
    }
    const q = this.queries.get(id);
    if (!q) return;
    if (type === "EVENT" && data[2] && typeof data[2] === "object") {
      if (q.live) q.live(data[2] as Event);
      else q.events.push(data[2] as Event);
    } else if (type === "EOSE" && q.live) {
      clearTimeout(q.timer);
      const stored = q.resolve;
      q.resolve = q.reject = () => undefined;
      stored([]);
    } else if (type === "EOSE") {
      clearTimeout(q.timer);
      this.queries.delete(id);
      this.send(["CLOSE", id]);
      q.resolve(q.events);
    } else if (type === "CLOSED") {
      clearTimeout(q.timer);
      this.queries.delete(id);
      q.reject(new Error(String(data[2] ?? "Requête refusée par le relais.")));
    }
  }
}

const now = (): number => Math.floor(Date.now() / 1000);
const tag = (e: Event, name: string): string | undefined => e.tags.find((t) => t[0] === name)?.[1];

export interface Conversation { id: string; name: string; members: string[] }
export interface Message { id: string; author: string; text: string; at: number; replyTo: string | null; mentions: string[] }

/** The channels (salons and direct messages) the key belongs to, with their name and members. */
export async function conversations(c: BuzzConnection, me: string): Promise<Conversation[]> {
  const rosters = await c.query({ kinds: [39002], "#p": [me] });
  const ids = [...new Set(rosters.map((r) => tag(r, "d")).filter((d): d is string => Boolean(d)))];
  if (!ids.length) return [];
  const meta = await c.query({ kinds: [39000], "#d": ids });
  return ids.map((id) => {
    const m = meta.find((e) => tag(e, "d") === id);
    const roster = rosters.find((r) => tag(r, "d") === id);
    return { id, name: (m && tag(m, "name")) || "Conversation", members: (roster?.tags ?? []).filter((t) => t[0] === "p").map((t) => t[1] as string) };
  });
}

export const toMessage = (e: Event): Message => ({
  id: e.id,
  author: e.pubkey,
  text: e.content,
  at: e.created_at,
  replyTo: e.tags.find((t) => t[0] === "e" && t[3] === "reply")?.[1] ?? null,
  mentions: e.tags.filter((t) => t[0] === "p" && typeof t[1] === "string").map((t) => t[1] as string),
});

/** Oldest first; at the same second, a message before the replies to it. */
export const sortMessages = (list: Message[]): Message[] => [...list].sort((a, b) => a.at - b.at || Number(a.replyTo !== null) - Number(b.replyTo !== null));

/** `thread` with `m` appended, unless it is already there. */
export const withMessage = (thread: Message[] | null, m: Message): Message[] => (thread?.some((x) => x.id === m.id) ? thread : [...(thread ?? []), m]);

/**
 * A thread in one REQ: the last `limit` messages through `onLoad` at EOSE, then each new one through `onLive`.
 * The relay sends stored events newest first, hence the sort.
 */
export function follow(c: BuzzConnection, channel: string, on: { onLoad: (m: Message[]) => void; onLive: (m: Message) => void; onError: (e: Error) => void }, limit = 50): Subscription {
  let stored: Message[] | null = [];
  return c.subscribe(
    { kinds: MESSAGE_KINDS, "#h": [channel], limit },
    (e) => (stored ? stored.push(toMessage(e)) : on.onLive(toMessage(e))),
    {
      onStored: () => {
        const all = sortMessages(stored ?? []);
        stored = null;
        on.onLoad(all);
      },
      onError: on.onError,
    },
  );
}

/** Rosters that change from now on (a new conversation, a member added): `onChange` on each. */
export const watchRosters = (c: BuzzConnection, me: string, onChange: () => void): Subscription =>
  c.subscribe({ kinds: [39002], "#p": [me], since: now() }, onChange);

/** `mentions` : clés d'Experts interpellés (étiquette `p`) ; un Expert ne travaille que si son propriétaire le mentionne. */
export function sendMessage(c: BuzzConnection, channel: string, text: string, replyTo: string | null, mentions: string[] = []) {
  const tags = [["h", channel], ...(replyTo ? [["e", replyTo, "", "reply"]] : []), ...mentions.map((k) => ["p", k])];
  return c.publish({ kind: 9, created_at: now(), tags, content: text });
}

/** Opens (or reuses) a direct conversation; Buzz answers with the channel it created. */
export async function openDirect(c: BuzzConnection, pubkeys: string[]): Promise<string> {
  const r = await c.publish({ kind: 41010, created_at: now(), tags: [...pubkeys.map((p) => ["p", p]), ["d", crypto.randomUUID()]], content: "" });
  const id = /"channel_id":"([0-9a-f-]{36})"/.exec(r.message)?.[1];
  if (!r.ok || !id) throw new Error(r.message.replace(/^[a-z-]+: /, "") || "Conversation non ouverte.");
  return id;
}
