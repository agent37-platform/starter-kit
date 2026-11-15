import assert from "node:assert/strict";
import { test } from "node:test";
import { paragraphCache } from "./paragraph-cache.ts";

const upper = () => {
  const seen: string[] = [];
  const fn = paragraphCache(
    (t: string) => (seen.push(t), t.toUpperCase()),
    (a, b) => a + b
  );
  return { fn, seen };
};

test("a growing text gives the same result as rewriting the whole", () => {
  const { fn } = upper();
  const full = "un\n\ndeux trois\n\nquatre";
  for (let i = 0; i <= full.length; i++) assert.equal(fn(full.slice(0, i)), full.slice(0, i).toUpperCase());
});

test("finished paragraphs are rewritten once, only the tail again", () => {
  const { fn, seen } = upper();
  fn("un\n\nde");
  fn("un\n\ndeu");
  fn("un\n\ndeux\n\ntr");
  assert.deepEqual(seen, ["un\n\n", "de", "deu", "deux\n\n", "tr"]);
});

test("a text that is not the continuation starts afresh", () => {
  const { fn, seen } = upper();
  fn("un\n\ndeux");
  seen.length = 0;
  assert.equal(fn("autre\n\nchose"), "AUTRE\n\nCHOSE");
  assert.deepEqual(seen, ["autre\n\n", "chose"]);
});
