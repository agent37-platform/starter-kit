// The mobile app reads its instance here with the back office's access token in `Authorization: Bearer`,
// no cookie. Only these routes (reads, and the chat's writes), and only without a session cookie; the token is checked against the
// project's keys first, then goes down the cookie's own path (same access checks). Pure, so it is tested.
// Contract: docs/plans/mobile-par-la-passerelle.md.
import type { VerifiedClaims } from "./jwt.ts";

const AGENT = "^\\/api\\/agents\\/[A-Za-z0-9_-]{1,64}\\/";
const ID = "[A-Za-z0-9_.:-]{1,128}";
const READ = new RegExp(`${AGENT}(deliverables|files\\/tree|files\\/content|files\\/thumb|events|chat\\/sessions|chat\\/sessions\\/${ID}|chat\\/by-profile|chat\\/responses\\/${ID}\\/stream)$`);
// The phone's chat: the same conversations as the web, written the same way (a turn, stopping it, an approval).
const WRITE = new RegExp(`${AGENT}chat\\/(files|responses|responses\\/${ID}\\/(cancel|approval|steer))$`);
// The phone's salons (Buzz): the overview (relay address, directory, salons), admitting the phone's own key, opening a
// salon, and the notice that the member wrote. The messages themselves go phone ⇄ relay, signed by the phone's key.
const BUZZ_READ = /^\/api\/buzz$/;
const BUZZ_WRITE = /^\/api\/buzz\/(devices|salons|sent)$/;
// A file over 4 MB from the phone, in parts (lib/upload-parts.ts): started, each part, then where it goes.
const UPLOAD_WRITE = new RegExp(`^\\/api\\/uploads(\\/${ID}\\/(parts\\/\\d{1,2}|complete))?$`);

export const bearerRoute = (method: string, pathname: string): boolean =>
  ((method === "GET" || method === "HEAD") && (READ.test(pathname) || BUZZ_READ.test(pathname))) || (method === "POST" && (WRITE.test(pathname) || BUZZ_WRITE.test(pathname) || UPLOAD_WRITE.test(pathname)));

export interface BearerRequest {
  method: string;
  pathname: string;
  hasCookieSession: boolean;
  authorization: string | null;
  workspaceHeader: string | null;
  /** The workspace this request is pinned to; undefined only in the legacy single-database mode. */
  workspace: string | undefined;
}

export type BearerDecision =
  | null
  | { refuse: { status: 401 | 404; code: string; message: string } }
  | { session: { accessToken: string; refreshToken: string; expiresAt: number } };

/** null: not a bearer request, the usual gate decides. Otherwise the session to read it with, or a refusal. */
export async function bearerDecision(r: BearerRequest, verify: (token: string) => Promise<VerifiedClaims | null>): Promise<BearerDecision> {
  if (r.hasCookieSession || !bearerRoute(r.method, r.pathname)) return null;
  const token = /^Bearer ([A-Za-z0-9._-]{20,8000})$/.exec(r.authorization?.trim() ?? "")?.[1];
  if (!token) return null;
  if (r.workspaceHeader && r.workspace && r.workspaceHeader.trim() !== r.workspace) {
    return { refuse: { status: 404, code: "not_found", message: "Cet espace n’existe pas." } };
  }
  const claims = await verify(token).catch(() => null);
  if (!claims) return { refuse: { status: 401, code: "unauthorized", message: "Sign in required" } };
  // No refresh token: the phone renews its own session, this server never does it for it.
  return { session: { accessToken: token, refreshToken: "", expiresAt: claims.exp } };
}
