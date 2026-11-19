import { test } from "node:test";
import assert from "node:assert/strict";
import { mailPreview } from "./mail-preview.ts";

test("an e-mail approval reads as an e-mail; anything else does not", () => {
  const p = mailPreview(
    "Envoyer un e-mail depuis la boîte de votre expert à rambert@ringcp.com, nc@ringcp.com\nCc : aude@mstudio.vc\nObjet : Re: Yelema x Ring\nPièces jointes : pipe.pdf, executif.pdf\nÀ vérifier : Soraya Abj, rapprochée par déduction\n\nHello Rambert,\n\nComme discuté…"
  );
  assert.deepEqual(p?.to, ["rambert@ringcp.com", "nc@ringcp.com"]);
  assert.deepEqual(p?.cc, ["aude@mstudio.vc"]);
  assert.equal(p?.subject, "Re: Yelema x Ring");
  assert.deepEqual(p?.attachments, ["pipe.pdf", "executif.pdf"]);
  assert.equal(p?.doubts, "Soraya Abj, rapprochée par déduction");
  assert.equal(p?.body, "Hello Rambert,\n\nComme discuté…");
  const bare = mailPreview("Envoyer un e-mail depuis la boîte de votre expert à a@b.ci");
  assert.deepEqual(bare?.to, ["a@b.ci"]);
  assert.equal(bare?.subject, null);
  assert.equal(mailPreview("Supprimer 3 e-mails"), null);
});
