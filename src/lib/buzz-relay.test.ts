import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { generateSecretKey } from "nostr-tools/pure";
import { BuzzConnection, follow, sortMessages, watchRosters, withMessage } from "./buzz-relay.ts";

// A relay that authenticates the browser, then goes silent: what a dropped connection looks like here.
class SilentRelay {
  static OPEN = 1;
  static last: SilentRelay | null = null;
  readyState = 1;
  closed = false;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    SilentRelay.last = this;
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(["AUTH", "défi"]) }));
  }
  send(raw: string): void {
    const [type, auth] = JSON.parse(raw) as [string, { id: string }];
    if (type === "AUTH") queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(["OK", auth.id, true, ""]) }));
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
}

test("un relais muet : la requête échoue, la connexion est fermée et son propriétaire prévenu pour la rouvrir", async () => {
  (globalThis as { WebSocket?: unknown }).WebSocket = SilentRelay;
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const c = new BuzzConnection("wss://relais.test", generateSecretKey());
    const connecting = c.connect();
    await new Promise((r) => setImmediate(r));
    mock.timers.tick(0);
    await connecting;
    let dropped = 0;
    c.onclose = () => dropped++;
    const pending = c.query({ kinds: [9] });
    mock.timers.tick(15_000);
    await assert.rejects(pending, /ne répond pas/);
    assert.equal(dropped, 1);
    assert.equal(SilentRelay.last?.closed, true);
  } finally {
    mock.timers.reset();
  }
});

// A relay that answers each REQ with its stored events then EOSE, and records what the browser sent.
class StoredRelay {
  static OPEN = 1;
  static last: StoredRelay | null = null;
  static stored: unknown[] = [];
  readyState = 1;
  sent: unknown[][] = [];
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    StoredRelay.last = this;
    queueMicrotask(() => this.emit(["AUTH", "défi"]));
  }
  emit(data: unknown[]): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  send(raw: string): void {
    const msg = JSON.parse(raw) as unknown[];
    this.sent.push(msg);
    if (msg[0] === "AUTH") queueMicrotask(() => this.emit(["OK", (msg[1] as { id: string }).id, true, ""]));
    if (msg[0] === "REQ") queueMicrotask(() => (StoredRelay.stored.forEach((e) => this.emit(["EVENT", msg[1], e])), this.emit(["EOSE", msg[1]])));
  }
  close(): void {
    this.readyState = 3;
  }
}

const ev = (id: string, at: number, reply?: string) => ({ id, pubkey: "a", content: id, created_at: at, kind: 9, tags: [["h", "fil"], ...(reply ? [["e", reply, "", "reply"]] : [])], sig: "" });
const settle = () => new Promise((r) => setImmediate(r));

async function opened(): Promise<BuzzConnection> {
  (globalThis as { WebSocket?: unknown }).WebSocket = StoredRelay;
  const c = new BuzzConnection("wss://relais.test", generateSecretKey());
  await c.connect();
  return c;
}

test("un fil en une seule requête : l'historique trié à la fin du stock, puis le direct sur la même requête", async () => {
  StoredRelay.stored = [ev("c", 30), ev("b", 20, "a"), ev("a", 20)];
  const c = await opened();
  const loads: string[][] = [];
  const live: string[] = [];
  const sub = follow(c, "fil", { onLoad: (m) => loads.push(m.map((x) => x.id)), onLive: (m) => live.push(m.id), onError: () => assert.fail("échec") });
  await settle();
  assert.deepEqual(loads, [["a", "b", "c"]]);
  const reqs = StoredRelay.last!.sent.filter((m) => m[0] === "REQ");
  assert.equal(reqs.length, 1);
  assert.deepEqual((reqs[0][2] as { limit: number }).limit, 50);
  assert.ok(!StoredRelay.last!.sent.some((m) => m[0] === "CLOSE"), "la requête reste ouverte après la fin du stock");
  StoredRelay.last!.emit(["EVENT", reqs[0][1], ev("d", 40)]);
  assert.deepEqual(live, ["d"]);
  sub.close();
  assert.deepEqual(StoredRelay.last!.sent.at(-1), ["CLOSE", reqs[0][1]]);
  c.close();
});

test("une coupure après le chargement du fil ne le marque pas en échec (la reconnexion le relit)", async () => {
  StoredRelay.stored = [];
  const c = await opened();
  let errors = 0;
  follow(c, "fil", { onLoad: () => undefined, onLive: () => undefined, onError: () => errors++ });
  await settle();
  c.close();
  assert.equal(errors, 0);
});

test("un relais muet pendant le chargement du fil : échec signalé et connexion rendue à son propriétaire", async () => {
  (globalThis as { WebSocket?: unknown }).WebSocket = SilentRelay;
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const c = new BuzzConnection("wss://relais.test", generateSecretKey());
    const connecting = c.connect();
    await settle();
    mock.timers.tick(0);
    await connecting;
    let dropped = 0;
    let errors = 0;
    c.onclose = () => dropped++;
    follow(c, "fil", { onLoad: () => assert.fail("chargé"), onLive: () => assert.fail("direct"), onError: () => errors++ });
    mock.timers.tick(15_000);
    assert.equal(errors, 1);
    assert.equal(dropped, 1);
  } finally {
    mock.timers.reset();
  }
});

test("les listes : une réponse après son message à la même seconde, pas de doublon", () => {
  const m = (id: string, at: number, replyTo: string | null = null) => ({ id, author: "a", text: "", at, replyTo, mentions: [] });
  assert.deepEqual(sortMessages([m("r", 5, "a"), m("a", 5), m("z", 1)]).map((x) => x.id), ["z", "a", "r"]);
  const t = withMessage(null, m("a", 1));
  assert.equal(withMessage(t, m("a", 1)), t);
  assert.deepEqual(withMessage(t, m("b", 2)).map((x) => x.id), ["a", "b"]);
});

test("la veille des conversations ne lit que les changements à venir et prévient à chaque roster", async () => {
  StoredRelay.stored = [];
  const c = await opened();
  let changes = 0;
  watchRosters(c, "moi", () => changes++);
  await settle();
  const req = StoredRelay.last!.sent.find((m) => m[0] === "REQ")!;
  const filter = req[2] as { kinds: number[]; "#p": string[]; since: number };
  assert.deepEqual([filter.kinds, filter["#p"]], [[39002], ["moi"]]);
  assert.ok(filter.since > 0);
  StoredRelay.last!.emit(["EVENT", req[1], { id: "x", tags: [["d", "c1"]] }]);
  assert.equal(changes, 1);
  c.close();
});
