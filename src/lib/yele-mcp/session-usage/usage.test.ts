import assert from "node:assert/strict";
import { test } from "node:test";
import { usageForPeriod } from "../periods.ts";
import { METRIC_KEYS, parseSessionUsage, tokensOf, usageByDayOf, usageByProfile, withRoutineErrors } from "./usage.ts";

// Une ligne telle que le lecteur l'émet : clés, puis les chiffres dans l'ordre de METRIC_KEYS.
const figures = (o: Partial<Record<(typeof METRIC_KEYS)[number], number>>) => METRIC_KEYS.map((k) => o[k] ?? 0);
const stdout = JSON.stringify({
  rows: [
    ["2026-11-09T21", "koffi", "cron", "claude-opus-5-5", "fd5f7a744fe6", ...figures({ sessions: 1, inputTokens: 10, outputTokens: 500, cacheReadTokens: 180_000, cacheWriteTokens: 60_000, durationMs: 11_000 })],
    ["2026-11-10T09", "koffi", "agent37-gateway", "default", "", ...figures({ sessions: 2, messages: 12, toolCalls: 4, inputTokens: 90, outputTokens: 3_000, cacheReadTokens: 40_000 })],
    ["2026-11-10T10", "yele", "telegram", "default", "", ...figures({ sessions: 1, outputTokens: 100, cacheWriteTokens: 900 })],
  ],
  totals: [
    ["koffi", "cron", "claude-opus-5-5", "fd5f7a744fe6", ...figures({ sessions: 5, inputTokens: 50, outputTokens: 2_500, cacheReadTokens: 900_000 })],
    ["koffi", "agent37-gateway", "default", "", ...figures({ sessions: 2, inputTokens: 90, outputTokens: 3_000, cacheReadTokens: 40_000 })],
  ],
  tools: [["2026-11-10T09", "koffi", "agent37-gateway", "default", "", "terminal", 7]],
  skills: [["2026-11-10", "koffi", "cron", "claude-opus-5-5", "fd5f7a744fe6", "rendre-livrable", 2]],
  composio: [["2026-11-10", "koffi", "agent37-gateway", "default", "", "GOOGLESHEETS_BATCH_GET", 3]],
  unreadable: ["nadia"],
});

test("parseSessionUsage : lignes avec leurs dimensions (profil, canal, modèle, routine), totaux, appels et profils illisibles", () => {
  const u = parseSessionUsage(stdout);
  assert.equal(u.rows.length, 3);
  assert.deepEqual(
    { slot: u.rows[0].slot, profile: u.rows[0].profile, source: u.rows[0].source, model: u.rows[0].model, routine: u.rows[0].routine },
    { slot: "2026-11-09T21", profile: "koffi", source: "cron", model: "claude-opus-5-5", routine: "fd5f7a744fe6" }
  );
  assert.equal(u.rows[1].routine, "");
  assert.equal(u.totals[0].slot, "");
  assert.equal(u.totals[0].routine, "fd5f7a744fe6");
  assert.equal(u.totals[0].sessions, 5);
  assert.deepEqual(u.tools, [{ slot: "2026-11-10T09", profile: "koffi", source: "agent37-gateway", model: "default", routine: "", name: "terminal", calls: 7 }]);
  assert.deepEqual(u.skills[0], { slot: "2026-11-10", profile: "koffi", source: "cron", model: "claude-opus-5-5", routine: "fd5f7a744fe6", name: "rendre-livrable", calls: 2 });
  assert.equal(u.composio[0].name, "GOOGLESHEETS_BATCH_GET");
  assert.deepEqual(u.unreadable, ["nadia"]);
  assert.throws(() => parseSessionUsage(JSON.stringify({ rows: "x" })));
  assert.deepEqual(parseSessionUsage(JSON.stringify({ rows: [], totals: [] })).tools, []);
});

test("usageByProfile : un modèle appelé en appoint a des tokens mais aucune session", () => {
  const out = JSON.stringify({
    rows: [],
    totals: [
      ["koffi", "agent37-gateway", "default", "", ...figures({ sessions: 1, apiCalls: 4, outputTokens: 1_000 })],
      ["koffi", "agent37-gateway", "openai/gpt-6-luna", "", ...figures({ apiCalls: 1, inputTokens: 300 })],
    ],
  });
  const koffi = usageByProfile(parseSessionUsage(out).totals).koffi;
  assert.equal(koffi.count, 1);
  assert.deepEqual(koffi.models, { default: 1 });
  assert.deepEqual(koffi.modelTokens, { default: 1_000, "openai/gpt-6-luna": 300 });
  assert.equal(koffi.totalTokens, 1_300);
});

test("tokensOf : entrée, sortie et cache lu ou écrit, comme le relevé des routines les compte", () => {
  // Les chiffres d'une vraie routine de Djénéba : 889 + 33 980 + 8 488 188 + 3 386 117 = son total d'audit.
  assert.equal(
    tokensOf({ ...parseSessionUsage(stdout).rows[0], inputTokens: 889, outputTokens: 33_980, cacheReadTokens: 8_488_188, cacheWriteTokens: 3_386_117 }),
    11_909_174
  );
});

test("usageByProfile : sessions, tokens, modèles et canaux d'un expert", () => {
  const koffi = usageByProfile(parseSessionUsage(stdout).totals).koffi;
  assert.equal(koffi.count, 7);
  assert.equal(koffi.totalTokens, 902_550 + 43_090);
  assert.equal(koffi.completionTokens, 5_500);
  assert.equal("costUsd" in koffi, false);
  assert.deepEqual(koffi.models, { "claude-opus-5-5": 5, default: 2 });
  assert.deepEqual(koffi.sources, {
    cron: { sessions: 5, tokens: 902_550 },
    "agent37-gateway": { sessions: 2, tokens: 43_090 },
  });
});

test("usageByDayOf puis usageForPeriod : la période additionne les jours, canaux compris", () => {
  const byDay = usageByDayOf(parseSessionUsage(stdout).rows);
  assert.deepEqual(Object.keys(byDay).sort(), ["2026-11-09", "2026-11-10"]);
  const now = Date.parse("2026-11-10T12:00:00Z");
  const today = usageForPeriod(byDay, "aujourdhui", now);
  assert.deepEqual(Object.keys(today).sort(), ["koffi", "yele"]);
  assert.equal(today.koffi.count, 2);
  assert.equal(today.koffi.messages, 12);
  const week = usageForPeriod(byDay, "7_jours", now);
  assert.equal(week.koffi.count, 3);
  assert.deepEqual(Object.keys(week.koffi.sources!).sort(), ["agent37-gateway", "cron"]);
});

test("withRoutineErrors : les échecs viennent de l'audit des routines, le reste des sessions", () => {
  const usage = usageByProfile(parseSessionUsage(stdout).totals);
  withRoutineErrors(usage, { koffi: 2, absent: 1 });
  assert.equal(usage.koffi.errors, 2);
  assert.equal(usage.koffi.count, 7);
  assert.equal(usage.absent, undefined);
});
