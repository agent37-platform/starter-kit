import assert from "node:assert/strict";
import { test } from "node:test";
import { autoRequest } from "./auto-request.ts";

const minutes = `Compte rendu de réunion à rédiger (Google Meet). Elle a commencé le 2026-11-20T09:01:47.000Z (UTC). Participants : Leslie Ossete, Selim Traoré.

La transcription est dans « ~/Livrables/Djeneba/Réunions/261120-090116/transcription.md ».

3. Écris « ~/Livrables/Djeneba/Réunions/261120-090116/compte-rendu.json », en JSON valide, exactement dans cette forme :`;

const publish = `Publie le compte rendu « Tech Yelema, point de suivi du 20 novembre » sur Frames, comme tes tableaux de bord : crée une nouvelle page (POST /api/frames).

Ensuite écris « ~/Livrables/Djeneba/Réunions/261120-090116/.page.json », en JSON valide :`;

test("the platform's orders read as one line, never as the member's words", () => {
  assert.deepEqual(autoRequest(minutes), { kind: "minutes", label: "Compte rendu de la réunion du 20 novembre demandé automatiquement" });
  assert.deepEqual(autoRequest(publish), { kind: "publish", label: "Mise en ligne du compte rendu demandée automatiquement" });
  assert.equal(autoRequest("Compte rendu de réunion à rédiger (Teams).")?.label, "Compte rendu de la réunion demandé automatiquement");
  assert.equal(autoRequest("Lis ~/Livrables/x/plan.md puis écris ~/Livrables/x/etat.json en JSON valide.")?.kind, "other");
  assert.equal(autoRequest("Range « ~/Livrables/Koffi/a.pdf » dans « ~/Livrables/Koffi/Clients/ ».")?.kind, "other");
});

test("a member's own message stays a bubble", () => {
  assert.equal(autoRequest("Peux-tu me faire le compte rendu de la réunion de ce matin ?"), null);
  assert.equal(autoRequest("Publie le post LinkedIn demain"), null);
  assert.equal(autoRequest("Mets le tableau en JSON stp"), null);
  assert.equal(autoRequest("Ouvre ~/Livrables/Koffi/devis.pdf et corrige le total"), null);
});
