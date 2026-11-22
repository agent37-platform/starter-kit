import assert from "node:assert/strict";
import { test } from "node:test";
import { nightCounts, nightOf, nightStart, nightSummary } from "./nuit.ts";

const NOW = Date.UTC(2026, 10, 21, 7, 30); // samedi 21/11, 7 h 30 à Abidjan
const s = (h: number) => Math.floor((NOW + h * 3_600_000) / 1000);
const iso = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

test("the night starts the evening before at 18:00, or tonight after 18:00", () => {
  assert.equal(nightStart(NOW), Date.UTC(2026, 10, 20, 18));
  assert.equal(nightStart(Date.UTC(2026, 10, 21, 19)), Date.UTC(2026, 10, 21, 18));
});

test("tasks and routines of the night, each with its state", () => {
  const items = nightOf(
    [
      { id: "t1", titre: "Analyse des 40 fournisseurs", statut: "done", creee: s(-12), debut: s(-11), fin: s(-6), resume: "Tableau prêt.", blocage: null, conversation: "c1" },
      { id: "t2", titre: "Relancer les impayés", statut: "blocked", creee: s(-12), debut: s(-11), fin: null, resume: null, blocage: "Accès Gmail coupé depuis 23 h", conversation: null },
      { id: "t3", titre: "Vieille tâche", statut: "done", creee: s(-60), debut: s(-59), fin: s(-58), resume: null, blocage: null, conversation: null },
      { id: "t4", titre: "Veille concurrents", statut: "running", creee: s(-2), debut: s(-1), fin: null, resume: null, blocage: null, conversation: null },
    ],
    [
      { id: "r1", name: "Point du matin", enabled: true, lastRunAt: iso(-0.5), nextRunAt: iso(23.5) },
      { id: "r2", name: "Relances clients", enabled: true, lastRunAt: iso(-30), nextRunAt: iso(-3) },
      { id: "r3", name: "En pause", enabled: false, lastRunAt: null, nextRunAt: iso(-3) },
      { id: "r4", name: "Ce soir", enabled: true, lastRunAt: iso(-30), nextRunAt: iso(10) },
    ],
    NOW
  );
  assert.deepEqual(items.map((i) => [i.id, i.state]), [["r1", "fait"], ["t4", "en-cours"], ["r2", "pas-parti"], ["t1", "fait"], ["t2", "bloque"]]);
  assert.equal(items.find((i) => i.id === "t2")?.detail, "Accès Gmail coupé depuis 23 h");
  assert.equal(items.find((i) => i.id === "t1")?.session, "c1");
  assert.equal(nightSummary(nightCounts(items)), "2 faits, 1 bloqué, 1 pas parti, 1 en cours");
  assert.equal(nightSummary(nightCounts([])), "");
});
