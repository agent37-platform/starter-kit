import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCipheriv, randomBytes } from "node:crypto";
import { shareEndOf, shareExpiryOf } from "./dashboard-expiry.ts";
import { LEGACY_LINKS_END, openShare, sealShare, shareKey } from "./dashboard-token.ts";

const KEY = shareKey({ DASHBOARD_SHARE_SECRET: "une-cle-de-test-assez-longue" });
const OTHER = shareKey({ DASHBOARD_SHARE_SECRET: "une-autre-cle-de-test-longue" });
const NOW = Date.parse("2026-11-06T12:00:00Z");
const DAY = 86_400_000;
const CLAIMS = { w: "ws-a", s: "shr_4f1c9a0e2b7d4c6f8a1e3b5d7c9f0a2b", n: "Q2h4cVd0Z3pMbW5Yb1ZhUjM", e: NOW + 30 * DAY };

// A link sealed before ends existed (v2), as the server sealed it then.
function sealV2(key: Buffer, c: { w: string; s: string; n: string }): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ v: 2, ...c }), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

describe("jeton de partage d'un tableau", () => {
  it("s'ouvre avec la même clé et ne laisse lire ni le partage ni son numéro", () => {
    const token = sealShare(CLAIMS, KEY)!;
    assert.deepEqual(openShare(token, KEY, NOW), CLAIMS);
    const plain = Buffer.from(token, "base64url").toString("latin1");
    assert.ok(!plain.includes("shr_") && !plain.includes(CLAIMS.n));
  });

  it("refuse une autre clé, un jeton altéré, tronqué ou étranger", () => {
    const token = sealShare(CLAIMS, KEY)!;
    assert.equal(openShare(token, OTHER), null);
    const flipped = token.slice(0, 15) + (token[15] === "A" ? "B" : "A") + token.slice(16);
    assert.equal(openShare(flipped, KEY), null);
    assert.equal(openShare(token.slice(0, 20), KEY), null);
    assert.equal(openShare("agentId=7p5qy2effr", KEY), null);
    assert.equal(openShare("x".repeat(600), KEY), null);
  });

  it("ne garde que le client, le partage et son numéro : ni instance ni profil dans le lien", () => {
    const token = sealShare({ ...CLAIMS, agentId: "7p5qy2effr", profile: "fatima" } as typeof CLAIMS, KEY)!;
    assert.deepEqual(openShare(token, KEY, NOW), CLAIMS);
    assert.ok(!/7p5qy2effr|fatima/.test(Buffer.from(token, "base64url").toString("latin1")));
  });

  it("sans clé, le partage est coupé", () => {
    assert.equal(shareKey({}), null);
    assert.equal(sealShare(CLAIMS, null), null);
    assert.equal(openShare(sealShare(CLAIMS, KEY), null), null);
  });

  it("refuse un lien passé sa fin, en le disant ; « sans fin » ne tombe jamais", () => {
    const token = sealShare(CLAIMS, KEY)!;
    assert.deepEqual(openShare(token, KEY, CLAIMS.e - 1), CLAIMS);
    assert.equal(openShare(token, KEY, CLAIMS.e), "expired");
    assert.equal(openShare(token, KEY, CLAIMS.e + 365 * DAY), "expired");
    const forever = sealShare({ ...CLAIMS, e: null }, KEY)!;
    assert.deepEqual(openShare(forever, KEY, NOW + 3650 * DAY), { ...CLAIMS, e: null });
  });

  it("une fin altérée ou absente rend le lien invalide", () => {
    const bad = sealShare({ ...CLAIMS, e: "jamais" as unknown as number }, KEY)!;
    assert.equal(openShare(bad, KEY, NOW), null);
    const missing = sealShare({ ...CLAIMS, e: undefined as unknown as null }, KEY)!;
    assert.equal(openShare(missing, KEY, NOW), null);
  });

  it("un ancien lien (v2) s'ouvre jusqu'à la date de transition, puis tombe", () => {
    const old = sealV2(KEY!, { w: CLAIMS.w, s: CLAIMS.s, n: CLAIMS.n });
    assert.deepEqual(openShare(old, KEY, NOW), { w: CLAIMS.w, s: CLAIMS.s, n: CLAIMS.n, e: LEGACY_LINKS_END });
    assert.equal(openShare(old, KEY, LEGACY_LINKS_END), "expired");
  });

  it("durée choisie : 7, 30, 90 jours ou sans fin ; 30 jours par défaut", () => {
    assert.equal(shareEndOf("7", NOW), NOW + 7 * DAY);
    assert.equal(shareEndOf("90", NOW), NOW + 90 * DAY);
    assert.equal(shareEndOf("none", NOW), null);
    assert.equal(shareExpiryOf(undefined), "30");
    assert.equal(shareExpiryOf("365"), "30");
    assert.equal(shareExpiryOf("none"), "none");
  });

  it("n'emprunte jamais le secret du resolver", () => {
    assert.equal(shareKey({ APP_RESOLVER_TOKEN: "secret-du-resolver-0123456789" }), null);
    assert.equal(shareKey({ DASHBOARD_SHARE_SECRET: "trop-court" }), null);
  });
});
