import assert from "node:assert/strict";
import { test } from "node:test";

import { BUDGET_EXCEEDED, CREDIT_EXHAUSTED, INTERRUPTED_REPLY, LOOP_STOPPED_REPLY, OFFLINE, OUT_OF_STEPS_REPLY, UNREACHABLE, attachedFiles, chatFailureMessage, cleanReply, cleanUserMessage, isAccountToTopUp, networkFailure } from "./chat-errors.ts";

test("the gateway's budget refusal becomes the budget sentence", () => {
  assert.equal(chatFailureMessage('litellm.BudgetExceededError: {"error":{"type":"budget_exceeded"}}', "x"), BUDGET_EXCEEDED);
  assert.equal(chatFailureMessage("Error code: 400 - Budget has been exceeded! Current cost: 200.1", "x"), BUDGET_EXCEEDED);
});

test("a request that never got through says which side failed (Leslie, 28/10)", () => {
  assert.equal(chatFailureMessage("Load failed", "x", false), OFFLINE);
  assert.equal(chatFailureMessage("Failed to fetch", "x", false), OFFLINE);
  assert.equal(chatFailureMessage("Load failed", "x", true), UNREACHABLE);
  assert.equal(chatFailureMessage("NetworkError when attempting to fetch resource.", "x"), UNREACHABLE);
});

test("anything else keeps the caller's sentence", () => {
  assert.equal(chatFailureMessage("Connection reset", "Réessayez."), "Réessayez.");
  assert.equal(chatFailureMessage(undefined, "Réessayez."), "Réessayez.");
  assert.equal(chatFailureMessage("", "Réessayez."), "Réessayez.");
});

test("cleanReply drops the runtime's English lines and repeated paragraphs", () => {
  const raw = "System: your previous response was truncated. Continue.\n\nVoici le point.\n\nVoici le point.\n\nYour request was not processed, send it again.";
  assert.equal(cleanReply(raw), "Voici le point.");
  assert.equal(cleanReply("⚡ Command invoked: /tableau\nJe prépare le tableau."), "Je prépare le tableau.");
  assert.equal(cleanReply("Rien à retirer."), "Rien à retirer.");
  assert.equal(cleanReply("Voici l’affiche.\nMEDIA:/home/node/Livrables/Koffi/affiche.png"), "Voici l’affiche.");
});

test("a provider out of credit gets its own sentence, which the bell recognises", () => {
  assert.equal(chatFailureMessage("Error code: 400 - Your credit balance is too low to access the Anthropic API", "x"), CREDIT_EXHAUSTED);
  assert.equal(chatFailureMessage("insufficient_quota", "x"), CREDIT_EXHAUSTED);
  assert.equal(chatFailureMessage("timeout", "x"), "x");
  assert.ok(isAccountToTopUp(CREDIT_EXHAUSTED) && isAccountToTopUp(BUDGET_EXCEEDED) && !isAccountToTopUp("x"));
});

test("a member's message loses the runtime's continuation orders, and only them", () => {
  const order = "[System: Your previous response was truncated by the output length limit. Continue exactly where you left off. Do not restart or repeat prior text. Finish the answer directly.]";
  assert.equal(cleanUserMessage(`Peux tu stp faire une analyse de mon compte linkedin?\n\n${order}\n\n${order}`), "Peux tu stp faire une analyse de mon compte linkedin?");
  assert.equal(cleanUserMessage("Le système : à revoir\n\nMerci"), "Le système : à revoir\n\nMerci");
});

test("the files the runtime appends to a saved member message become chips, never paths", () => {
  const saved = "j'ai besoin que tu maîtrises le contexte\n\n[Attached files:\n- /home/node/Livrables/Pièces jointes/62b69t5b-pack-ministere_v1.zip\n- /home/node/Livrables/Pièces jointes/a1b2c3d4-photo.JPG]";
  assert.deepEqual(attachedFiles(saved), {
    text: "j'ai besoin que tu maîtrises le contexte",
    files: [
      { name: "pack-ministere_v1.zip", path: "/home/node/Livrables/Pièces jointes/62b69t5b-pack-ministere_v1.zip", isImage: false },
      { name: "photo.JPG", path: "/home/node/Livrables/Pièces jointes/a1b2c3d4-photo.JPG", isImage: true },
    ],
  });
  assert.deepEqual(attachedFiles("[Attached files:\n- /home/node/Livrables/Koffi/logo-v2.png]").files, [
    { name: "logo-v2.png", path: "/home/node/Livrables/Koffi/logo-v2.png", isImage: true },
  ]);
  assert.deepEqual(attachedFiles("Rien de joint."), { text: "Rien de joint.", files: [] });
  assert.deepEqual(attachedFiles("Cite [Attached files: au milieu] du texte").files, []);
});

test("cleanReply hides delegation notices and markers, and says an interrupted turn in French", () => {
  assert.equal(cleanReply("✅ ASYNC DELEGATION BATCH COMPLETE\nSalif a rendu l'analyse."), "Salif a rendu l'analyse.");
  assert.equal(cleanReply("Task 3f2a completed. Check the result\nLe planning est prêt."), "Le planning est prêt.");
  assert.equal(cleanReply("[DÉLÉGUER → Salif] Je confie le planning à Salif."), "Je confie le planning à Salif.");
  assert.equal(cleanReply("Operation interrupted: waiting for model response (12.0s elapsed)."), INTERRUPTED_REPLY);
  assert.equal(cleanReply("La tâche est terminée, je vous envoie le fichier."), "La tâche est terminée, je vous envoie le fichier.");
});

test("the engine's English stop messages read as a French sentence, never their details", () => {
  const loop = "I stopped retrying because I kept running skill_view 5 times without making progress. The last result above shows what blocked it. Tell me how you'd like to proceed, or send `continue` and I'll try a different approach.";
  assert.equal(cleanReply(loop), LOOP_STOPPED_REPLY);
  assert.equal(cleanReply(`Je regarde le livrable.\n\n${loop}`), `Je regarde le livrable.\n\n${LOOP_STOPPED_REPLY}`);
  assert.equal(cleanReply("I ran out of steps for this turn (90 tool calls) before finishing, and couldn't produce a summary."), OUT_OF_STEPS_REPLY);
  assert.equal(cleanReply("I reached the iteration limit and couldn't generate a summary."), OUT_OF_STEPS_REPLY);
  assert.equal(cleanReply("Hermes hit repeated errors and stopped this turn so it wouldn't keep retrying.\n\nDetails: KeyError 'x'"), INTERRUPTED_REPLY);
  assert.equal(cleanReply("No reply: the turn stopped while a tool result was still pending. Send `continue` to let the model summarize."), INTERRUPTED_REPLY);
  assert.equal(cleanReply("Details: voir le tableau ci-dessous."), "Details: voir le tableau ci-dessous.");
  assert.equal(chatFailureMessage("This turn did not complete. Some actions may already have run; verify their effects before resending.", "x"), INTERRUPTED_REPLY);
});

test("a request that never got through reads as a French sentence, an abort stays one", () => {
  assert.equal(networkFailure(new TypeError("Failed to fetch")), UNREACHABLE);
  assert.equal(networkFailure(new TypeError("Load failed"), false), OFFLINE);
  assert.equal(networkFailure(new Error("NetworkError when attempting to fetch resource.")), UNREACHABLE);
  assert.equal(networkFailure(new DOMException("stopped", "AbortError")), null);
  assert.equal(networkFailure(new Error("Cet Expert n’est pas dans votre équipe.")), null);
});
