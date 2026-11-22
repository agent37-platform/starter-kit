import assert from "node:assert/strict";
import { test } from "node:test";
import { callFiles, pickCall } from "./call-conversation.ts";
import type { CallRecord } from "./voice.ts";

const call = (id: string, startedAt: string): CallRecord => ({ id, expert: "fatima", language: "fr", status: "ended", startedAt, endedAt: null, durationSeconds: 60, subject: null, summary: [], subjectPending: false });

test("l'appel d'une conversation : le sien, sinon le plus proche à 10 min près", () => {
  const calls = [call("a", "2026-11-20T14:05:00Z"), call("b", "2026-11-20T09:00:00Z")];
  assert.equal(pickCall(calls, "b", null)?.id, "b");
  assert.equal(pickCall(calls, "x", Date.UTC(2026, 10, 20, 14, 7))?.id, "a");
  assert.equal(pickCall(calls, "x", Date.UTC(2026, 10, 20, 12, 0)), null);
});

test("les fichiers de l'appel : écrits pendant l'appel et le quart d’heure d’après, dossiers exclus", () => {
  const t = Date.UTC(2026, 10, 20, 14, 0);
  const f = (name: string, min: number, type = "file") => ({ name, path: `~/Livrables/Fatima/${name}`, type, size: 1, modified: t + min * 60_000 });
  const got = callFiles([f("avant.pdf", -30), f("plan.pptx", 5), f("Dossier", 6, "directory"), f("visuel.png", 22), f("tard.docx", 30)], t, t + 10 * 60_000);
  assert.deepEqual(got, ["~/Livrables/Fatima/visuel.png", "~/Livrables/Fatima/plan.pptx"]);
});
