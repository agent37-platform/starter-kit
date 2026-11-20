import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "node:test";

import { bearerDecision, bearerRoute, type BearerRequest } from "./bearer-access.ts";
import { verifyEs256, type Jwk } from "./jwt.ts";

const ISS = "https://ref.supabase.co/auth/v1";
const NOW_S = 1_762_000_000;
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk: Jwk = { ...(publicKey.export({ format: "jwk" }) as Jwk), kid: "k1", alg: "ES256" };
function token(payload: Record<string, unknown>): string {
  const input = `${b64({ alg: "ES256", kid: "k1", typ: "JWT" })}.${b64({ aud: "authenticated", iss: ISS, sub: "user-1", ...payload })}`;
  return `${input}.${sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}
// The real check of the session cookie's token (lib/session.ts verifiedAccessToken), at a fixed time.
const verify = async (t: string) => {
  const c = verifyEs256(t, [jwk], { issuer: ISS, audience: "authenticated", nowS: NOW_S });
  return c.ok ? c.claims : null;
};
const good = token({ exp: NOW_S + 3600 });
const req = (over: Partial<BearerRequest> = {}): BearerRequest => ({
  method: "GET", pathname: "/api/agents/inst00001/deliverables", hasCookieSession: false, authorization: `Bearer ${good}`, workspaceHeader: "ws1", workspace: "ws1", ...over,
});

describe("🔒 jeton de l'app mobile sur les routes d'instance", () => {
  it("un jeton valide devient la session de cette seule requête (mêmes contrôles d'accès que le cookie ensuite)", async () => {
    assert.deepEqual(await bearerDecision(req(), verify), { session: { accessToken: good, refreshToken: "", expiresAt: NOW_S + 3600 } });
    for (const p of ["files/tree", "files/content", "files/thumb", "events"]) assert.ok(bearerRoute("GET", `/api/agents/inst00001/${p}`), p);
  });

  it("le chat du téléphone : lire les conversations, écrire un tour, l'arrêter, répondre à une demande d'accord", () => {
    for (const p of ["chat/sessions", "chat/sessions/20261118_101200_ab12cd", "chat/by-profile", "chat/responses/resp_abc123/stream"]) assert.ok(bearerRoute("GET", `/api/agents/inst00001/${p}`), p);
    for (const p of ["chat/responses", "chat/responses/resp_abc123/cancel", "chat/responses/resp_abc123/approval", "chat/responses/resp_abc123/steer", "chat/files"]) assert.ok(bearerRoute("POST", `/api/agents/inst00001/${p}`), p);
    for (const p of ["/api/uploads", "/api/uploads/up_abc123/parts/0", "/api/uploads/up_abc123/parts/8", "/api/uploads/up_abc123/complete"]) assert.ok(bearerRoute("POST", p), p);
    for (const p of ["/api/uploads/up_abc123", "/api/uploads/up_abc123/parts/100", "/api/uploads/up_abc123/file"]) assert.ok(!bearerRoute("POST", p), p);
    for (const [m, p] of [
      ["DELETE", "chat/sessions/s1"],
      ["PATCH", "chat/sessions/s1"],
      ["POST", "chat/sessions/s1/share"],
      ["GET", "chat/sessions/s1/share"],
      ["GET", "chat/files"],
      ["GET", "chat/models"],
      ["POST", "chat/sessions"],
      ["GET", "chat/sessions/../../x"],
    ] as const) assert.equal(bearerRoute(m, `/api/agents/inst00001/${p}`), false, `${m} ${p}`);
  });

  it("les salons du téléphone : l'aperçu Buzz, la clé du téléphone, ouvrir un salon, prévenir qu'on a écrit", () => {
    for (const m of ["GET", "HEAD"] as const) assert.ok(bearerRoute(m, "/api/buzz"));
    for (const p of ["devices", "salons", "sent"]) assert.ok(bearerRoute("POST", `/api/buzz/${p}`), p);
    for (const [m, p] of [
      ["DELETE", "/api/buzz/devices"],
      ["PATCH", "/api/buzz/salons/0b2c3d4e-0000-4000-8000-000000000000"],
      ["DELETE", "/api/buzz/salons/0b2c3d4e-0000-4000-8000-000000000000"],
      ["POST", "/api/buzz/salons/0b2c3d4e-0000-4000-8000-000000000000/guests"],
      ["POST", "/api/buzz"],
      ["GET", "/api/buzz/devices"],
      ["GET", "/api/buzzx"],
    ] as const) assert.equal(bearerRoute(m, p), false, `${m} ${p}`);
  });

  it("le cookie garde la main : un jeton à côté ne change rien", async () => {
    assert.equal(await bearerDecision(req({ hasCookieSession: true }), verify), null);
    assert.equal(await bearerDecision(req({ hasCookieSession: true, authorization: "Bearer xxxxxxxxxxxxxxxxxxxxxxxxxxxx" }), verify), null);
  });

  it("jeton expiré, d'une autre clé ou illisible : 401", async () => {
    const refused = { refuse: { status: 401, code: "unauthorized", message: "Sign in required" } };
    assert.deepEqual(await bearerDecision(req({ authorization: `Bearer ${token({ exp: NOW_S - 1 })}` }), verify), refused);
    const other = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const input = `${b64({ alg: "ES256", kid: "k1" })}.${b64({ aud: "authenticated", iss: ISS, sub: "u", exp: NOW_S + 60 })}`;
    const forged = `${input}.${sign("sha256", Buffer.from(input), { key: other.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
    assert.deepEqual(await bearerDecision(req({ authorization: `Bearer ${forged}` }), verify), refused);
    assert.deepEqual(await bearerDecision(req({ authorization: "Bearer aaaaaaaaaaaaaaaaaaaaaaaaa.bbbb.cccc" }), verify), refused);
    assert.deepEqual(await bearerDecision(req(), async () => { throw new Error("jwks down"); }), refused);
  });

  it("autre espace que celui de l'adresse : 404, sans même vérifier le jeton", async () => {
    let checked = false;
    const d = await bearerDecision(req({ workspaceHeader: "ws2" }), async (t) => ((checked = true), verify(t)));
    assert.deepEqual(d, { refuse: { status: 404, code: "not_found", message: "Cet espace n’existe pas." } });
    assert.equal(checked, false);
  });

  it("jamais ailleurs : écriture, autre route, autre forme d'en-tête ⇒ la porte habituelle (401 sans cookie)", async () => {
    for (const over of [
      { method: "PUT", pathname: "/api/agents/inst00001/files/content" },
      { method: "DELETE", pathname: "/api/agents/inst00001/files" },
      { pathname: "/api/agents/inst00001/chat" },
      { pathname: "/api/agents/inst00001/files" },
      { pathname: "/api/agents/inst00001/files/tree/x" },
      { pathname: "/api/me" },
      { authorization: `Basic ${good}` },
      { authorization: null },
    ] satisfies Partial<BearerRequest>[]) {
      assert.equal(await bearerDecision(req(over), verify), null, JSON.stringify(over));
    }
  });
});
