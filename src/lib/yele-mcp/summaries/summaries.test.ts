import assert from "node:assert/strict";
import { test } from "node:test";
import { activityByExpert, sessionsPerProfile, sessionTime } from "./activity.ts";
import { channelIndex, expertEmail } from "./channels.ts";
import { sharePct, summarizeConsumption } from "./consumption.ts";

const koffi = { id: "koffi", name: "Koffi", description: "Créatif : images et vidéos" };
const fatima = { id: "fatima", name: "Fatima", description: "Juriste" };

test("sessionTime : dernière activité, sinon début, en millisecondes même quand l'instance donne des secondes", () => {
  assert.equal(sessionTime({ id: "a", last_active: 1_700_000_000 }), 1_700_000_000_000);
  assert.equal(sessionTime({ id: "a", last_active: 1_700_000_000_000, started_at: 5 }), 1_700_000_000_000);
  // Sans dernière activité, le début compte, converti lui aussi (il ne l'était pas pour la dernière activité affichée).
  assert.equal(sessionTime({ id: "a", started_at: 1_700_000_000 }), 1_700_000_000_000);
  assert.equal(sessionTime({ id: "a" }), 0);
});

test("activityByExpert : actifs depuis la coupure, le plus récent d'abord ; inactifs ; experts connus par leurs seules sessions", () => {
  const t = (h: number) => 1_762_000_000_000 + h * 3_600_000; // des millisecondes
  const { actifs, inactifs } = activityByExpert(
    [
      { id: "s1", profile: "koffi", last_active: t(2) },
      { id: "s2", profile: "koffi", last_active: t(3) },
      { id: "s3", profile: "salif", last_active: t(4) },
      { id: "s4", profile: "fatima", last_active: t(-1) },
    ],
    t(0),
    [koffi, fatima]
  );
  assert.deepEqual(
    actifs.map((a) => [a.expert.id, a.count, a.lastActive]),
    [
      ["salif", 1, t(4)],
      ["koffi", 2, t(3)],
    ]
  );
  assert.equal(actifs[0].expert.name, "Salif");
  assert.deepEqual(inactifs, [fatima]);
});

test("sessionsPerProfile : par profil, le plus sollicité d'abord, sans les sessions sans profil", () => {
  assert.deepEqual(
    sessionsPerProfile([
      { id: "1", profile: "Koffi" },
      { id: "2", profile: "fatima" },
      { id: "3", profile: "koffi" },
      { id: "4", profile: null },
    ]),
    [
      ["koffi", 2],
      ["fatima", 1],
    ]
  );
});

test("summarizeConsumption : totaux d'équipe, lignes triées, nom et rôle du catalogue sinon l'id", () => {
  const u = (totalTokens: number, count: number, totalDurationMs = 0) => ({
    count,
    totalTokens,
    promptTokens: totalTokens / 2,
    completionTokens: totalTokens / 2,
    totalDurationMs,
    errors: 0,
  });
  const s = summarizeConsumption({ fatima: u(100, 1, 4000), koffi: u(300, 2, 10_000), salif: u(0, 0) }, [koffi, fatima]);
  assert.deepEqual(
    { totalTokens: s.totalTokens, promptTokens: s.promptTokens, runs: s.runs, durationMs: s.durationMs },
    { totalTokens: 400, promptTokens: 200, runs: 3, durationMs: 14_000 }
  );
  assert.deepEqual(
    s.rows.map((r) => [r.expId, r.name, r.role, r.avgDurationSec]),
    [
      ["koffi", "Koffi", "Créatif", 5],
      ["fatima", "Fatima", "Juriste", 4],
      ["salif", "Salif", "Expert", 0],
    ]
  );
});

test("summarizeConsumption : sessions et canaux additionnés sur tous les experts, sans coût", () => {
  const u = (sources: Record<string, { sessions: number; tokens: number }>) => ({
    count: Object.values(sources).reduce((s, c) => s + c.sessions, 0),
    totalTokens: Object.values(sources).reduce((s, c) => s + c.tokens, 0),
    promptTokens: 0,
    completionTokens: 0,
    errors: 0,
    sources,
  });
  const s = summarizeConsumption({
    koffi: u({ cron: { sessions: 2, tokens: 300 }, telegram: { sessions: 1, tokens: 50 } }),
    fatima: u({ cron: { sessions: 1, tokens: 100 } }),
  });
  assert.equal(s.runs, 4);
  assert.equal("costUsd" in s, false);
  assert.deepEqual(s.channels, [
    ["cron", { sessions: 3, tokens: 400 }],
    ["telegram", { sessions: 1, tokens: 50 }],
  ]);
});

test("sharePct : une décimale, 0.0 quand le total est nul", () => {
  assert.equal(sharePct(1, 3), "33.3");
  assert.equal(sharePct(5, 0), "0.0");
});

test("channelIndex et expertEmail : fil et adresse par id en minuscules, aucune adresse inventée", () => {
  const index = channelIndex({ topics: { "12": "Koffi", "15": "fatima" } }, { addresses: { KOFFI: "koffi@client.fr" } });
  assert.deepEqual(index.topicByExpert, { koffi: "12", fatima: "15" });
  assert.equal(expertEmail(index, "koffi"), "koffi@client.fr");
  assert.equal(expertEmail(index, "fatima"), undefined);
  assert.deepEqual(channelIndex(null, null), { topicByExpert: {}, mailByExpert: {} });
});
