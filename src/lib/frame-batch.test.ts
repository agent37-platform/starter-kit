import assert from "node:assert/strict";
import { test } from "node:test";
import { frameBatch } from "./frame-batch.ts";

function fakeFrames() {
  const queued: (() => void)[] = [];
  return {
    schedule: (run: () => void) => queued.push(run),
    unschedule: (h: unknown) => void (queued[(h as number) - 1] = () => {}),
    tick: () => queued.splice(0).forEach((run) => run()),
    count: () => queued.length,
  };
}

test("many pushes in a frame apply once, with the latest value per key", () => {
  const f = fakeFrames();
  const applied: [string, number][][] = [];
  const b = frameBatch<string, number>((p) => applied.push([...p]), f.schedule, f.unschedule);
  b.push("a", 1);
  b.push("a", 2);
  b.push("b", 3);
  assert.equal(f.count(), 1);
  assert.deepEqual(applied, []);
  f.tick();
  assert.deepEqual(applied, [[["a", 2], ["b", 3]]]);
});

test("flush applies at once and the pending frame does nothing more", () => {
  const f = fakeFrames();
  const applied: number[] = [];
  const b = frameBatch<string, number>((p) => applied.push(...p.values()), f.schedule, f.unschedule);
  b.push("a", 1);
  b.flush();
  f.tick();
  assert.deepEqual(applied, [1]);
  b.push("a", 2);
  f.tick();
  assert.deepEqual(applied, [1, 2]);
});

test("cancel drops what is pending", () => {
  const f = fakeFrames();
  const applied: number[] = [];
  const b = frameBatch<string, number>((p) => applied.push(...p.values()), f.schedule, f.unschedule);
  b.push("a", 1);
  b.cancel();
  f.tick();
  b.flush();
  assert.deepEqual(applied, []);
});
