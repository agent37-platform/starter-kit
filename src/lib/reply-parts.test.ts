import assert from "node:assert/strict";
import { test } from "node:test";
import { choiceMessage, replyParts } from "./reply-parts.ts";

const QUESTION = "J’ai le texte. Il me manque un choix pour le visuel :\n\nA) Photo du stand (par défaut)\nB) Bouteille de jus 1 L\nC) Carrousel de 3 images";

test("the options a question ends on become choices", () => {
  const p = replyParts(QUESTION);
  assert.equal(p.body, "J’ai le texte. Il me manque un choix pour le visuel :");
  assert.deepEqual(p.choices.map((c) => c.letter), ["A", "B", "C"]);
  assert.equal(p.choices[0].label, "Photo du stand");
  assert.equal(p.choices[0].isDefault, true);
  assert.equal(p.choices[1].isDefault, false);
});

test("the usual ways of writing an option", () => {
  for (const [a, b] of [["A. Oui", "B. Non"], ["**A** : Oui", "**B** : Non"], ["- A) Oui", "- B) Non"], ["**A)** Oui", "**B)** Non"], ["A : Oui", "B : Non"]]) {
    const p = replyParts(`On y va ?\n${a}\n${b}`);
    assert.deepEqual(p.choices.map((c) => c.label), ["Oui", "Non"], a);
  }
  assert.equal(replyParts("On y va ?\n\nA) Oui\n\nB) Non").choices.length, 2);
});

test("one short line may follow the options", () => {
  const p = replyParts("On y va ?\nA) Oui\nB) Non\n\nSans réponse, je pars sur A à 15 h.");
  assert.equal(p.choices.length, 2);
  assert.equal(p.choicesNote, "Sans réponse, je pars sur A à 15 h.");
});

test("what is not clearly a question stays text", () => {
  for (const t of [
    "Voici le plan.\nA) Préparer\nB) Livrer",
    "A) Oui\nB) Non",
    "Tu préfères quoi ?\nA) Oui",
    "Tu préfères quoi ?\nA) Oui\nC) Non",
    "Tu préfères quoi ?\nB) Oui\nC) Non",
    "Le code :\n```\nA) x\nB) y",
    `Tu préfères quoi ?\nA) ${"long ".repeat(30)}\nB) Non`,
    `Tu préfères quoi ?\nA) Oui\nB) Non\n${"suite ".repeat(40)}`,
    "Une réponse ordinaire.",
  ]) {
    const p = replyParts(t);
    assert.deepEqual(p.choices, [], t);
    assert.equal(p.body.trimEnd(), t.trimEnd(), t);
  }
});

test("what a button sends", () => {
  assert.equal(choiceMessage({ letter: "B", label: "Non", isDefault: false }), "B : Non");
});

test("a list announced by « : » without a choice is not turned into buttons", () => {
  assert.deepEqual(replyParts("Les étapes :\nA) Préparer\nB) Livrer").choices, []);
  assert.deepEqual(replyParts("Deux pistes :\nA) Salon\nB) Radio\nJe recommande A.").choices, []);
  assert.deepEqual(replyParts("Deux pistes :\nA) Salon\nB) Radio\nLaquelle te va ?").choices.map((c) => c.letter), ["A", "B"]);
  assert.deepEqual(replyParts("Quelle version préférez-vous :\nA) Courte\nB) Longue").choices.map((c) => c.letter), ["A", "B"]);
});

test("numbered choices work like lettered ones", () => {
  const p = replyParts("Quelle option préférez-vous ?\n\n1. Envoyer ce soir (par défaut)\n2. Attendre lundi\n3) Annuler");
  assert.deepEqual(p.choices.map((c) => [c.letter, c.label, c.isDefault]), [["1", "Envoyer ce soir", true], ["2", "Attendre lundi", false], ["3", "Annuler", false]]);
  assert.equal(p.body, "Quelle option préférez-vous ?");
  assert.equal(choiceMessage(p.choices[1]), "2 : Attendre lundi");
  for (const t of ["Voici les étapes :\n1. Préparer\n2. Livrer", "On fait comment ?\n1. Oui\n3. Non", "On fait comment ?\nA) Oui\n2) Non", "On fait comment ?\n2. Oui\n3. Non", "1. Oui\n2. Non"]) {
    assert.deepEqual(replyParts(t).choices, [], t);
  }
});
