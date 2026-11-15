import assert from "node:assert/strict";
import { test } from "node:test";
import { settledByKey, spaceKey, within } from "./first-screen.ts";

test("un premier écran lu à temps est transmis ; en retard ou en échec, le navigateur le lit lui-même", async () => {
  assert.equal(await within(Promise.resolve(1), 50), 1);
  assert.equal(await within(new Promise((r) => setTimeout(() => r(1), 200)), 10), null);
  assert.equal(await within(Promise.reject(new Error("x")), 50), null);
});

test("chaque espace sous sa clé, ceux en échec laissés de côté", async () => {
  const keys = [spaceKey("a", null), spaceKey("a", "awa")];
  assert.deepEqual(keys, ["a:", "a:awa"]);
  const out = await settledByKey(keys, async (k) => (k === "a:" ? 1 : Promise.reject(new Error("down"))));
  assert.deepEqual(out, { "a:": 1 });
});
