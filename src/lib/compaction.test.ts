import assert from "node:assert/strict";
import { test } from "node:test";
import { isCompactionSummary, visibleHistory, withoutCompactionNote } from "./compaction.ts";

test("a compaction summary is never a message, one marker per compaction", () => {
  const rows = [
    { role: "user", content: "Le deck SIREXE" },
    { role: "system", content: "📚 La conversation devenait longue…" },
    { role: "assistant", content: "[PRIOR CONTEXT — for reference only; not a new message]\n\n[CONTEXT COMPACTION — REFERENCE ONLY] …Livrables/Koffi/_memoire/brief.md" },
    { role: "system", content: "📚 La conversation devenait longue…" },
    { role: "user", content: "[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted" },
    { role: "assistant", content: "La version 4 est prête." },
  ];
  assert.deepEqual(visibleHistory(rows).map((r) => r.role), ["user", "system", "assistant"]);
  assert.ok(isCompactionSummary("This session is being continued from a previous conversation that ran out of context."));
  assert.ok(!isCompactionSummary("Voici le résumé de la réunion."));
});

test("a long reply replayed further down the thread shows once, a short one may recur", () => {
  const long = "Le relevé de décisions de la réunion déploiement est prêt dans vos Livrables.";
  const rows = [
    { role: "user", content: "Le relevé ?" },
    { role: "assistant", content: long },
    { role: "user", content: "Merci" },
    { role: "assistant", content: "C'est noté." },
    { role: "user", content: "Et le tableau ?" },
    { role: "assistant", content: long },
    { role: "assistant", content: "C'est noté." },
    { role: "assistant", content: "Le tableau est en ligne, je vous mets le lien." },
  ];
  assert.deepEqual(
    visibleHistory(rows).map((r) => r.content),
    ["Le relevé ?", long, "Merci", "C'est noté.", "Et le tableau ?", "C'est noté.", "Le tableau est en ligne, je vous mets le lien."],
  );
});

test("a member's message saved several times at once shows once, the same words sent later twice", () => {
  const rows = [
    { role: "user", content: "Le point des mails ?", created_at: "2026-11-02T08:03:00Z" },
    { role: "user", content: "Le point des mails ? ", created_at: "2026-11-02T08:03:00Z" },
    { role: "user", content: "Le point des mails ?", created_at: "2026-11-02T08:03:00Z" },
    { role: "assistant", content: "Trois mails attendent une réponse." },
    { role: "user", content: "?", created_at: "2026-11-02T08:14:00Z" },
    { role: "user", content: "?", created_at: "2026-11-02T08:15:00Z" },
  ];
  assert.deepEqual(
    visibleHistory(rows).map((r) => `${r.role}:${r.content.trim()}`),
    ["user:Le point des mails ?", "assistant:Trois mails attendent une réponse.", "user:?", "user:?"],
  );
});

test("the task list Hermes keeps across a compaction is never shown, and the marker shows once", () => {
  const note = "[Your active task list was preserved across context compression]\n- [>] Draft the deck\nskill_view(name='salif/4-livrables/deck')";
  const rows = [
    { role: "user", content: "Le livrable ?" },
    { role: "system", content: "📚 La conversation devenait longue…" },
    { role: "user", content: note },
    { role: "system", content: "📚 La conversation devenait longue…" },
    { role: "assistant", content: "Le livrable est prêt." },
  ];
  assert.deepEqual(visibleHistory(rows).map((r) => r.role), ["user", "system", "assistant"]);
  assert.ok(!isCompactionSummary("Your active task list, as I understand it: the deck."));
});

test("a compaction note folded at the end of a message is cut, the text before it kept", () => {
  const rows = [
    { role: "assistant", content: "Le deck est prêt.\n\n[Your active task list was preserved across context compression]\n- [>] Draft" },
    { role: "assistant", content: "Le tableau [PRIOR CONTEXT] reste en ligne." },
  ];
  assert.deepEqual(visibleHistory(rows).map((r) => r.content), ["Le deck est prêt.", "Le tableau [PRIOR CONTEXT] reste en ligne."]);
  assert.equal(withoutCompactionNote("Bonjour"), "Bonjour");
});
