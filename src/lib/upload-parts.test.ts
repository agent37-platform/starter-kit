import { test } from "node:test";
import assert from "node:assert/strict";
import { PartsError, sendInParts } from "./upload-parts.ts";

type Call = { url: string; method: string; size?: number; body?: string };

function fakeFetch(answer: (c: Call, i: number) => Response | Error) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const body = init.body;
    const c: Call = { url, method: init.method ?? "GET", ...(body instanceof Blob ? { size: body.size } : { body: body as string }) };
    calls.push(c);
    const a = answer(c, calls.length - 1);
    if (a instanceof Error) throw a;
    return a;
  }) as unknown as typeof fetch;
  return { f, calls };
}
const ok = (data: unknown = { ok: true }) => new Response(JSON.stringify(data), { status: 200 });

test("a 7 MB file goes in three parts of 3, 3 and 1 MB, then where it goes", async () => {
  const file = new Blob([new Uint8Array(7 * 1024 * 1024)], { type: "application/pdf" });
  const { f, calls } = fakeFetch((c) => (c.url === "/api/uploads" ? ok({ id: "up1" }) : c.url.endsWith("/complete") ? ok({ path: "~/a.pdf" }) : ok()));
  const seen: number[] = [];
  const res = await sendInParts(Object.assign(file, { name: "a.pdf" }), { kind: "chat", agentId: "i1" }, { partBytes: 3 * 1024 * 1024, fetch: f, onProgress: (p) => seen.push(p) });
  assert.deepEqual(res, { path: "~/a.pdf" });
  assert.deepEqual(JSON.parse(calls[0].body!), { name: "a.pdf", type: "application/pdf", size: 7 * 1024 * 1024, parts: 3 });
  assert.deepEqual(calls.slice(1, 4).map((c) => [c.url, c.size]), [
    ["/api/uploads/up1/parts/0", 3 * 1024 * 1024],
    ["/api/uploads/up1/parts/1", 3 * 1024 * 1024],
    ["/api/uploads/up1/parts/2", 1024 * 1024],
  ]);
  assert.deepEqual(JSON.parse(calls[4].body!), { to: { kind: "chat", agentId: "i1" } });
  assert.equal(seen.length, 3);
  assert.equal(seen[2], 1);
});

test("a part cut by the network is sent again; a refusal stops and drops the parts", async () => {
  const file = new Blob([new Uint8Array(10)]);
  let cut = 0;
  const { f, calls } = fakeFetch((c) => {
    if (c.url === "/api/uploads") return ok({ id: "up2" });
    if (c.url.endsWith("/parts/0") && cut++ === 0) return new TypeError("network");
    if (c.url.endsWith("/parts/1")) return new Response(JSON.stringify({ error: { message: "Non." } }), { status: 403 });
    return ok();
  });
  await assert.rejects(sendInParts(file, { kind: "memory", title: "x" }, { partBytes: 5, fetch: f }), (e: unknown) => e instanceof PartsError && e.status === 403 && e.message === "Non.");
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ["POST /api/uploads", "POST /api/uploads/up2/parts/0", "POST /api/uploads/up2/parts/0", "POST /api/uploads/up2/parts/1", "DELETE /api/uploads/up2"]);
});

test("a back office without parts answers 404 at the start", async () => {
  const { f } = fakeFetch(() => new Response("{}", { status: 404 }));
  await assert.rejects(sendInParts(new Blob([new Uint8Array(10)]), { kind: "chat", agentId: "i1" }, { partBytes: 5, fetch: f }), (e: unknown) => e instanceof PartsError && e.status === 404);
});
