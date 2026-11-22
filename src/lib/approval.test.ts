import assert from "node:assert/strict";
import { test } from "node:test";
import { addApproval, autoApproves, answerOutcome, expireOpen, isApprovalChoice, isOpen, parseApproval, settleApproval } from "./approval.ts";

const NOW = Date.parse("2026-11-08T10:00:00Z");

test("an event becomes a pending request; its text stays text", () => {
  const a = parseApproval({ request_id: "abc", message: "<img src=x onerror=alert(1)> Envoyer à awa@x.ci", choices: ["once", "always", "deny"], expires_at: "2026-11-08T10:05:00.000Z" }, NOW);
  assert.deepEqual(a, { requestId: "abc", message: "<img src=x onerror=alert(1)> Envoyer à awa@x.ci", choices: ["once", "always", "deny"], expiresAt: NOW + 300_000, state: "pending" });
});

test("no request id, or a too long one: nothing to answer", () => {
  assert.equal(parseApproval({ message: "x" }, NOW), null);
  assert.equal(parseApproval({ request_id: "x".repeat(257) }, NOW), null);
});

test("unknown choices dropped; once and deny always offered; no deadline: 5 min", () => {
  const a = parseApproval({ request_id: "r", choices: ["session", "always"] }, NOW);
  assert.deepEqual(a?.choices, ["once", "deny"]);
  assert.equal(a?.expiresAt, NOW + 300_000);
  assert.equal(parseApproval({ request_id: "r", choices: ["deny", "once"] }, NOW)?.choices.join(), "once,deny");
  assert.ok(parseApproval({ request_id: "r", message: "m".repeat(9000) }, NOW)!.message.length <= 8001);
});

test("a replayed request is added once; answered and expired states", () => {
  const a = parseApproval({ request_id: "r1" }, NOW)!;
  const list = addApproval(addApproval(undefined, a), a);
  assert.equal(list.length, 1);
  assert.deepEqual(settleApproval(list, "r1", "answered", "always")[0], { ...a, state: "answered", choice: "always" });
  assert.equal(isOpen(a, NOW), true);
  assert.equal(isOpen(a, a.expiresAt), false);
  assert.equal(expireOpen([a, { ...a, requestId: "r2", state: "answered" }])?.map((x) => x.state).join(), "expired,answered");
});

test("the instance's answer: 2xx answered, 409 expired, anything else an error", () => {
  assert.deepEqual([answerOutcome(200), answerOutcome(409), answerOutcome(502)], ["answered", "expired", "error"]);
  assert.deepEqual(["once", "always", "deny", "session", 1].map(isApprovalChoice), [true, true, true, false, false]);
});

test("accord donné d'office seulement pour un envoi lancé depuis la fenêtre Envoyer", () => {
  const dialog = (t: string) => t.includes("Utilise ce compte et aucun autre.");
  const sent = "Envoie ces 2 livrables à a@b.ci par e-mail, avec l’outil Gmail connecté :\n- ~/Livrables/a.pdf\n\nUtilise ce compte et aucun autre.";
  assert.equal(autoApproves([sent], "Envoyer un message avec Gmail : a@b.ci", dialog), true);
  assert.equal(autoApproves([sent], "Envoyer un e-mail depuis la boîte de votre expert à A@B.ci", dialog), true);
  assert.equal(autoApproves(["Envoie-le à a@b.ci"], "Envoyer un message avec Gmail : a@b.ci", dialog), false);
  // Another recipient, a batch, a reply, a deletion or a card without destination keep the card.
  assert.equal(autoApproves([sent], "Envoyer un message avec Gmail : x@pirate.io", dialog), false);
  assert.equal(autoApproves([sent], "Envoyer un message avec Gmail : a@b.ci, x@pirate.io", dialog), false);
  assert.equal(autoApproves([sent], "Envoyer un message avec Gmail : a@b.ci (et 1 autre(s))", dialog), false);
  assert.equal(autoApproves([sent], "Envoyer une réponse avec Gmail : a@b.ci", dialog), false);
  assert.equal(autoApproves([sent], "Supprimer avec Google Drive : a@b.ci", dialog), false);
  assert.equal(autoApproves([sent], "Envoyer un message avec Outlook", dialog), false);
  assert.equal(autoApproves([sent], "Envoyer un message sur Telegram (canal principal)", dialog), false);
  assert.equal(autoApproves([sent], "Envoyer un message avec Gmail : a@b.c", dialog), false);
  assert.equal(autoApproves([sent], "Envoyer un message avec Gmail : b.ci", dialog), false);
  // A recipient quoted in the file list, not in the « à … » line, does not count.
  const listed = "Envoie ce livrable à a@b.ci par e-mail, avec l’outil Gmail connecté :\n- ~/Livrables/x@pirate.io.pdf\n\nUtilise ce compte et aucun autre.";
  assert.equal(autoApproves([listed], "Envoyer un message avec Gmail : x@pirate.io", dialog), false);
});
