import { test } from "node:test";
import assert from "node:assert/strict";
import { commandText, sessionTitle } from "./session-title.ts";

test("a conversation opened by a command is named in French", () => {
  assert.equal(sessionTitle("Run tableau command #4", "/tableau"), "Tableau de bord");
  assert.equal(sessionTitle("Run tableau command", null), "Tableau de bord");
  assert.equal(sessionTitle(null, "/tableau"), "Tableau de bord");
  assert.equal(sessionTitle("/tableau #3", "Tableau de bord"), "Tableau de bord");
  assert.equal(sessionTitle("/onboarding", null), "Bien démarrer");
  assert.equal(sessionTitle("Run rapport command #2", null), "Commande rapport");
});

test("any other conversation keeps its title, else its first words", () => {
  assert.equal(sessionTitle("Relance des devis", "Relance"), "Relance des devis");
  assert.equal(sessionTitle("  ", "Bonjour Fatima"), "Bonjour Fatima");
  assert.equal(sessionTitle(null, null), null);
});

test("a bare command sent for the member reads as its button", () => {
  assert.equal(commandText("/onboarding"), "Bien démarrer");
  assert.equal(commandText(" /configuration "), "Ses outils");
  assert.equal(commandText("/memoire", "elle"), "Ce qu’elle sait");
  assert.equal(commandText("/memoire", "il"), "Ce qu’il sait");
  assert.equal(commandText("/memoire"), "Sa mémoire");
  assert.equal(commandText("/inconnue"), "/inconnue");
  assert.equal(commandText("/onboarding complet"), "/onboarding complet");
  assert.equal(sessionTitle("Run onboarding command #2", null), "Bien démarrer");
});
