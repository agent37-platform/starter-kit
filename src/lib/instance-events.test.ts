import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createEventHub, eventStreamOn, nextEvent, pollDue, reconnectDelay } from "./instance-events.ts";

const GW = { RUNTIME_GATEWAY_URL: "https://gw", RUNTIME_GATEWAY_TOKEN: "t".repeat(32) };

describe("instance event stream", () => {
  it("off unless EVENT_STREAM (or NEXT_PUBLIC_EVENT_STREAM) is on AND the gateway is set", () => {
    assert.equal(eventStreamOn({}), false);
    assert.equal(eventStreamOn(GW), false);
    assert.equal(eventStreamOn({ ...GW, EVENT_STREAM: "off" }), false);
    assert.equal(eventStreamOn({ EVENT_STREAM: "on" }), false);
    assert.equal(eventStreamOn({ ...GW, EVENT_STREAM: "on" }), true);
    assert.equal(eventStreamOn({ ...GW, NEXT_PUBLIC_EVENT_STREAM: " ON " }), true);
  });

  it("reconnects after 2 s, doubling up to 5 min, with jitter", () => {
    assert.equal(reconnectDelay(0, () => 0.5), 2_000);
    assert.equal(reconnectDelay(3, () => 0.5), 16_000);
    assert.equal(reconnectDelay(30, () => 0.5), 300_000);
    assert.equal(reconnectDelay(0, () => 0), 1_600);
    assert.equal(reconnectDelay(0, () => 1), 2_400);
  });

  it("hub: events reach the instance's listeners only; connected follows the stream", () => {
    const hub = createEventHub();
    const heard: string[] = [];
    const off = hub.on("a", (t) => heard.push(`a:${t}`));
    hub.on("b", (t) => heard.push(`b:${t}`));
    hub.emit("a", "turn.ended");
    off();
    hub.emit("a", "files.changed");
    assert.deepEqual(heard, ["a:turn.ended"]);
    assert.equal(hub.connected("a"), false);
    hub.setConnected("a", true);
    assert.equal(hub.connected("a"), true);
    hub.setConnected("a", false);
    assert.equal(hub.connected("a"), false);
  });

  it("nextEvent: resolves on the awaited kind, or on abort, and leaves no listener behind", async () => {
    const hub = createEventHub();
    const ctl = new AbortController();
    let woke = false;
    const p = nextEvent(hub, "a", "turn.ended", ctl.signal).then(() => (woke = true));
    hub.emit("a", "files.changed");
    await new Promise((r) => setImmediate(r));
    assert.equal(woke, false);
    hub.emit("a", "turn.ended");
    await p;
    assert.equal(woke, true);
    const aborted = new AbortController();
    const q = nextEvent(hub, "a", "turn.ended", aborted.signal);
    aborted.abort();
    await q;
  });
});

describe("dashboard poll beside the stream", () => {
  it("polls as before without the stream; with it, only past the safety delay", () => {
    assert.equal(pollDue(false, 0), true);
    assert.equal(pollDue(true, 5_000), false);
    assert.equal(pollDue(true, 30_000), true);
  });
});
