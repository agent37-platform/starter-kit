import assert from "node:assert/strict";
import { test } from "node:test";
import { oncePer } from "./once-per.ts";

test("once per window and per key", () => {
  const due = oncePer(1000);
  assert.equal(due("a", 0), true);
  assert.equal(due("a", 999), false);
  assert.equal(due("b", 999), true);
  assert.equal(due("a", 1000), true);
  assert.equal(due("a", 1500), false);
});
