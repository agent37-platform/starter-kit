import { test } from "node:test";
import assert from "node:assert/strict";
import { cardLines, fileKind, hiredOn, lastDeliverables, shareCardText, shortWhen } from "./expert-card.ts";

test("the panel shows the expert's last deliverables, not its notes, uploads or archives", () => {
  const f = "~/Livrables/Djénéba";
  const entries = [
    { name: "Rapport.pdf", path: `${f}/Rapport.pdf`, type: "file", modified: 30 },
    { name: "notes.md", path: `${f}/notes.md`, type: "file", modified: 50 },
    { name: "Plan.pptx", path: `${f}/Plans/Plan.pptx`, type: "file", modified: 40 },
    { name: "ancien.pdf", path: `${f}/Archivées/ancien.pdf`, type: "file", modified: 60 },
    { name: "x.pdf", path: `${f}/Pièces jointes/x.pdf`, type: "file", modified: 70 },
    { name: "Plans", path: `${f}/Plans`, type: "directory", modified: 80 },
    { name: "Autre.pdf", path: "~/Livrables/Fatima/Autre.pdf", type: "file", modified: 90 },
    { name: "a.xlsx", path: `${f}/a.xlsx`, type: "file", modified: 10 },
    { name: "b.xlsx", path: `${f}/b.xlsx`, type: "file", modified: 20 },
  ];
  assert.deepEqual(lastDeliverables(entries, f).map((e) => e.name), ["Plan.pptx", "Rapport.pdf", "b.xlsx", "a.xlsx"]);
  assert.equal(lastDeliverables(entries, f, 2).length, 2);
});

test("a file's kind and its day read short", () => {
  assert.equal(fileKind("Plan.pptx"), "Présentation");
  assert.equal(fileKind("x.zip"), "ZIP");
  const now = new Date(2026, 10, 18, 10);
  assert.equal(shortWhen(new Date(2026, 10, 18, 8).getTime(), now), "aujourd’hui");
  assert.equal(shortWhen(new Date(2026, 10, 17, 8).getTime(), now), "hier");
  assert.match(shortWhen(new Date(2026, 10, 2, 8).getTime(), now), /2 nov/);
});

test("the card's lines are 44 signs, in capitals without accents, and carry no date", () => {
  const lines = cardLines({ name: "Djénéba", company: "Unifood", team: "Direction", role: "Chief of Staff & Direction", key: "djeneba" });
  assert.equal(lines.length, 3);
  for (const l of lines) assert.equal(l.length, 44);
  assert.ok(lines[0].startsWith("YLMEXPDJENEBA<<DJENEBA"));
  assert.ok(lines[1].startsWith("UNIFOOD<<DIRECTION"));
  assert.ok(lines[2].startsWith("DJENEBA<<CHIEF<OF<STAFF<DIRECTION"));
  assert.ok(!/\d{6}/.test(lines.join("")));
});

test("« Partager » hands on the name, the job and the address", () => {
  assert.equal(shareCardText({ name: "Djénéba", role: "Chief of Staff", company: "Unifood", email: "djeneba@unifood.yelema.ai" }), "Djénéba, Chief of Staff\nExpert Yelema chez Unifood\ndjeneba@unifood.yelema.ai");
  assert.equal(shareCardText({ name: "Awa", role: null, company: null, email: null }), "Awa\nExpert Yelema");
});

test("« Embauché le » : la date du back-office en jj/mm/aaaa ; absente ou illisible, pas de ligne", () => {
  assert.equal(hiredOn("2026-10-14T15:03:11.000Z"), "14/10/2026");
  assert.equal(hiredOn(null), null);
  assert.equal(hiredOn("x"), null);
});
