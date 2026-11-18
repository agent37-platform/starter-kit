import { test } from "node:test";
import assert from "node:assert/strict";
import { citedPerson, isSendRequest } from "./next-action.ts";

test("la personne citée dans la demande", () => {
  assert.equal(citedPerson("Fais-moi le post de l'offre Prestige, c'est pour Moussa, il le présente demain."), "Moussa");
  assert.equal(citedPerson("Prépare le devis pour Moussa Traoré"), "Moussa Traoré");
  assert.equal(citedPerson("Un mail à Awa pour la réunion"), "Awa");
});

test("ni réseau, ni lieu, ni jour, ni l'Expert", () => {
  assert.equal(citedPerson("Fais-moi le post pour Facebook, format carré."), null);
  assert.equal(citedPerson("Le plan de la boutique à Abidjan pour Lundi"), null);
  assert.equal(citedPerson("Demande à Fatima de le refaire", "Fatima"), null);
  assert.equal(citedPerson("fais le post pour moi"), null);
});

test("une demande d'envoi ne se repropose pas", () => {
  assert.equal(isSendRequest("Envoie « post.png » à moi-même par e-mail."), true);
  assert.equal(isSendRequest("Envoie ces 4 livrables à a@b.ci par e-mail, avec l’outil Gmail connecté :"), true);
  assert.equal(isSendRequest("Envoie ce livrable à Moussa par WhatsApp"), true);
  assert.equal(isSendRequest("Fais-moi le post"), false);
});
