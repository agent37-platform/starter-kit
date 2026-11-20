import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fileLinkKey, fileLinkQuery, LINK_TTL_MS, signFileLink, verifyFileLink } from "./file-link.ts";

const key = fileLinkKey({ AGENT37_API_KEY: "sk_live_0123456789abcdef" })!;
const NOW = 1_762_000_000_000;
const P = "Livrables/Kouassi/a.pdf";

describe("🔒 lien signé d'un livrable", () => {
  it("valide 15 minutes pour son client, son instance et son chemin, rien d'autre", () => {
    const q = new URLSearchParams(fileLinkQuery(key, "ws1", "inst1", P, NOW));
    const exp = Number(q.get("e"));
    const sig = q.get("s")!;
    assert.equal(q.get("p"), P);
    assert.equal(exp, NOW + LINK_TTL_MS);
    assert.ok(verifyFileLink(key, "ws1", "inst1", P, exp, sig, NOW));
    assert.ok(!verifyFileLink(key, "ws2", "inst1", P, exp, sig, NOW), "autre client");
    assert.ok(!verifyFileLink(key, "ws1", "inst2", P, exp, sig, NOW), "autre instance");
    assert.ok(!verifyFileLink(key, "ws1", "inst1", "Livrables/Kouassi/b.pdf", exp, sig, NOW), "autre fichier");
    assert.ok(!verifyFileLink(key, "ws1", "inst1", P, exp, sig, exp + 1), "expiré");
    assert.ok(!verifyFileLink(key, "ws1", "inst1", P, exp, "faux", NOW));
    const far = NOW + 3_600_000;
    assert.ok(!verifyFileLink(key, "ws1", "inst1", P, far, signFileLink(key, "ws1", "inst1", P, far), NOW), "trop lointain");
  });

  it("sans clé de serveur, aucun lien", () => {
    assert.equal(fileLinkKey({}), null);
    assert.equal(fileLinkKey({ AGENT37_API_KEY: "court" }), null);
    // Behind the gateway, without an Agent37 key: its own secret; it wins over the key when both are set.
    assert.ok(fileLinkKey({ FILE_LINK_SECRET: "un-secret-de-liens-0123456789" }));
    assert.notDeepEqual(fileLinkKey({ FILE_LINK_SECRET: "un-secret-de-liens-0123456789", AGENT37_API_KEY: "sk_live_0123456789abcdef" }), key);
    const other = fileLinkKey({ AGENT37_API_KEY: "sk_live_autre_cle_0000000" })!;
    const exp = NOW + 60_000;
    assert.ok(!verifyFileLink(other, "ws1", "inst1", P, exp, signFileLink(key, "ws1", "inst1", P, exp), NOW));
  });
});
