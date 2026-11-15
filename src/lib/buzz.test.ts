import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationName, isSalonName, labelsOf, myExpertsIn, participants, peopleOf, salonPeople, shortName, startsRun, withPhotos, working, type BuzzEntry } from "./buzz.ts";

const k = (c: string) => c.repeat(64);
const directory: BuzzEntry[] = [
  { nom: "Leslie", type: "personne", membre: "16", cles: [k("a"), k("b")] },
  { nom: "Mamadou (de Leslie)", type: "expert", membre: "16", cles: [k("c")] },
  { nom: "Selim", type: "personne", membre: "21", cles: [k("d")] },
];

test("une clé se nomme d'après l'annuaire, tous appareils d'une personne confondus", () => {
  const labels = labelsOf(directory);
  assert.equal(labels.get(k("b")), "Leslie");
  assert.equal(labels.get(k("c")), "Mamadou (de Leslie)");
});

test("une conversation directe porte le nom des autres, sans doublon ni soi-même", () => {
  const labels = labelsOf(directory);
  assert.equal(conversationName([k("a"), k("b"), k("c"), k("d")], [k("d")], labels, "DM"), "Leslie, Mamadou (de Leslie)");
  assert.equal(conversationName([k("d")], [k("d")], labels, "DM (1)"), "DM (1)");
});

test("participants : un seul « vous » pour tous ses appareils, la clé du relais écartée", () => {
  const labels = labelsOf([...directory, { nom: "Djénéba (de Selim)", type: "expert", membre: "21", cles: [k("e")] }]);
  assert.deepEqual(participants([k("d"), k("f"), k("e"), k("0")], [k("d"), k("f")], labels), ["vous", "Djénéba (de Selim)"]);
});

test("annuaire par membre : soi d'abord (pour ses propres Experts), puis les autres avec leurs Experts", () => {
  const people = peopleOf([...directory, { nom: "Djénéba (de Selim)", type: "expert", membre: "21", cles: [k("e")] }], [k("d")]);
  assert.deepEqual(people.map((p) => [p.nom, p.self, p.person?.nom ?? null, p.experts.map((e) => e.nom)]), [
    ["Selim", true, null, ["Djénéba (de Selim)"]],
    ["Leslie", false, "Leslie", ["Mamadou (de Leslie)"]],
  ]);
});

test("salon : tout canal nommé autrement que « DM »", () => {
  assert.equal(isSalonName("DM"), false);
  assert.equal(isSalonName("Group DM (3)"), false);
  assert.equal(isSalonName("Clôture mensuelle"), true);
});

test("salon : je ne peux mentionner que MES Experts présents dans le salon", () => {
  const dir: BuzzEntry[] = [...directory, { nom: "Djénéba (de Selim)", type: "expert", membre: "21", cles: [k("e")] }, { nom: "Awa (de Selim)", type: "expert", membre: "21", cles: [k("f")] }];
  assert.deepEqual(myExpertsIn(dir, [k("d")], [k("d"), k("e"), k("c")]).map((e) => e.nom), ["Djénéba (de Selim)"], "ni Mamadou de Leslie, ni Awa hors du salon");
});

test("salon : un Expert « travaille » tant qu'il n'a pas répondu à ma dernière demande", () => {
  const dj: BuzzEntry = { nom: "Djénéba (de Selim)", type: "expert", membre: "21", cles: [k("e")] };
  const ask = { author: k("d"), at: 10, mentions: [k("e")] };
  assert.deepEqual(working([ask], [k("d")], [dj]).length, 1);
  assert.deepEqual(working([ask, { author: k("e"), at: 12, mentions: [] }], [k("d")], [dj]).length, 0);
  assert.deepEqual(working([{ author: k("a"), at: 10, mentions: [k("e")] }], [k("d")], [dj]).length, 0, "la mention d'un collègue ne la fait pas travailler");
});

test("participants d'un salon : par personne, soi en tête, l'Expert d'un absent sous son nom", () => {
  const dir: BuzzEntry[] = [...directory, { nom: "Djénéba (de Selim)", type: "expert", membre: "21", cles: [k("e")], profil: "djeneba" }];
  const groups = salonPeople(dir, [k("c"), k("d"), k("e"), k("f")], [k("d")]);
  assert.deepEqual(groups.map((g) => [g.nom, g.self, g.person?.nom ?? null, g.experts.map((e) => shortName(e.nom))]), [
    ["Selim", true, "Selim", ["Djénéba"]],
    ["Leslie", false, null, ["Mamadou"]],
  ]);
});

test("portrait : un Expert le reçoit d'après son profil, une personne jamais", () => {
  const dir = withPhotos([...directory, { nom: "Djénéba (de Selim)", type: "expert", membre: "21", cles: [k("e")], profil: "djeneba" }], (p) => (p === "djeneba" ? "/d.webp" : null));
  assert.equal(dir.find((e) => e.profil === "djeneba")?.photo, "/d.webp");
  assert.equal(dir[0]?.photo, undefined);
});

test("un même auteur enchaîne ses messages sans répéter son visage, sauf après 5 minutes", () => {
  assert.equal(startsRun(undefined, { author: "a", at: 0 }), true);
  assert.equal(startsRun({ author: "a", at: 0 }, { author: "a", at: 60 }), false);
  assert.equal(startsRun({ author: "a", at: 0 }, { author: "b", at: 60 }), true);
  assert.equal(startsRun({ author: "a", at: 0 }, { author: "a", at: 301 }), true);
});
