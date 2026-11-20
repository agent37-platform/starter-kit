import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { backoffice, BackofficeError, type BoOpenedSession } from "@/lib/backoffice";
import { memo } from "@/lib/memo";
import { authViaBackoffice, deploymentWorkspaceId, multiTenant, resolverToken, siteUrl, supabaseAnonKey, supabaseUrl } from "@/lib/runtime-config";
import { bearerDecision } from "@/lib/bearer-access";
import { guestCookieApplies, guestCookieName } from "@/lib/guest-access";
import { decodeSession, encodeSession, LEGACY_SESSION_COOKIE, secondsLeft, SESSION_COOKIE, sessionCookieOptions, sessionCookieValue, verifiedAccessToken } from "@/lib/session";
import { requestSiteOrigin } from "@/lib/site-url";
import { sealTenant, writeTenantHeader } from "@/lib/tenant-header";
import { hostOf, resolveHost, TenantError, type ResolvedTenant } from "@/lib/tenant-resolver";

// Where /login lives. Not nextUrl alone: behind a reverse proxy it carries the listen address (localhost:3000).
const loginOrigin = (request: NextRequest): string => requestSiteOrigin(multiTenant(), siteUrl(), hostOf(request.headers), request.nextUrl.origin);

export async function updateSession(request: NextRequest) {
  // Only this proxy writes the resolved client: whatever the browser sent is dropped.
  writeTenantHeader(request.headers, null);
  // An external guest's cookie is for /invite only: no other route ever sees it, even a stray one.
  if (request.cookies.has(GUEST_COOKIE) && !guestCookieApplies(request.nextUrl.pathname)) request.cookies.delete(GUEST_COOKIE);
  // Health checks come from the back-office, carry no session, and must answer even when the
  // Supabase variables are missing — so they skip the auth client entirely.
  if (request.nextUrl.pathname === "/api/health") return NextResponse.next({ request });

  // One deployment for every client: the host says whose request this is, before anything else.
  let workspace = deploymentWorkspaceId();
  if (multiTenant()) {
    const gate = await tenantGate(request);
    if (gate instanceof NextResponse) return gate;
    workspace = gate.tenant.workspaceId;
    writeTenantHeader(request.headers, sealTenant(gate.tenant, gate.host, resolverToken() ?? ""));
  }
  if (authViaBackoffice()) return updateBackofficeSession(request, workspace);

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    supabaseUrl()!,
    supabaseAnonKey()!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  // La racine est l'accueil connecté depuis le passage aux routes des maquettes : elle
  // n'est plus publique.
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/invite") ||
    pathname.startsWith("/dashboards") ||
    pathname.startsWith("/api/dashboards/shared") ||
    pathname.startsWith("/api/dashboards/frame") ||
    pathname.startsWith("/api/dashboards/file") ||
    SIGNED_FILE.test(pathname);

  if (!user && !isPublic) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: { code: "unauthorized", message: "Sign in required" } }, { status: 401 });
    }
    const url = new URL("/login", loginOrigin(request));
    url.searchParams.set("next", pathname + request.nextUrl.search); // a shared link keeps its ?c= / ?s=
    return NextResponse.redirect(url);
  }

  return response;
}

// A host the back office does not know, or a suspended client, gets its own page (JSON for the API)
// and nothing else: no sign-in screen, no session renewal. Otherwise, the client's workspace.
async function tenantGate(request: NextRequest): Promise<NextResponse | { tenant: ResolvedTenant; host: string }> {
  const refuse = (status: number, code: string, message: string, page: string) =>
    request.nextUrl.pathname.startsWith("/api/")
      ? NextResponse.json({ error: { code, message } }, { status })
      : NextResponse.rewrite(new URL(page, request.url), { status });

  const host = hostOf(request.headers);
  let tenant = null;
  try {
    tenant = host ? await resolveHost(host) : null;
  } catch (e) {
    const status = e instanceof TenantError ? e.status : 503;
    return NextResponse.json(
      { error: { code: "unavailable", message: "Le service est momentanément indisponible. Réessayez dans un instant." } },
      { status: status >= 500 ? status : 503 }
    );
  }
  if (!tenant) return refuse(404, "not_found", "Cet espace n’existe pas.", "/espace-introuvable");
  if (tenant.status === "suspended") return refuse(403, "suspended", "Cet espace est suspendu.", "/espace-suspendu");
  return { tenant, host: host! };
}

const GUEST_COOKIE = guestCookieName(process.env.NODE_ENV === "production");

// Renew the access token this long before it expires, so a request never leaves with a dead one.
const RENEW_BEFORE_S = 120;

// The requests of one page renew together: one call per refresh token, its answer shared, so they
// all leave with the same new session instead of racing the back office's token rotation.
const renewals = memo<BoOpenedSession>({ ttlMs: 30_000, maxEntries: 2000, maxFlightMs: 20_000 });
const renew = (refreshToken: string, workspace: string | undefined) =>
  renewals.get(`${workspace ?? ""}:${createHash("sha256").update(refreshToken).digest("hex")}`, () => backoffice.refresh(refreshToken, workspace));

// A deliverable's signed link carries its own proof (lib/file-link.ts): no session.
const SIGNED_FILE = /^\/api\/agents\/[A-Za-z0-9_-]{1,64}\/files\/signed$/;

function isPublicPath(pathname: string): boolean {
  return (
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/invite") ||
    pathname.startsWith("/espace-") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/dashboards") ||
    pathname.startsWith("/api/dashboards/shared") ||
    pathname.startsWith("/api/dashboards/frame") ||
    pathname.startsWith("/api/dashboards/file") ||
    SIGNED_FILE.test(pathname)
  );
}

// The same gate when the back office owns the sign-in: the session is one httpOnly cookie holding
// its tokens. It is renewed here, ahead of expiry, by asking the back office, which is also where
// a suspended member or client stops being let in. Whether the session is still GOOD is checked by
// the pages and routes themselves (lib/session); this only makes sure there is one.
async function updateBackofficeSession(request: NextRequest, workspace: string | undefined) {
  const { pathname } = request.nextUrl;
  let session = decodeSession(sessionCookieValue(request.cookies));
  let renewed: string | null = null;
  let dropped = false;

  // The mobile app: the token rides this request only (never renewed or set as a cookie here).
  const bearer = await bearerDecision(
    { method: request.method, pathname, hasCookieSession: Boolean(session), authorization: request.headers.get("authorization"), workspaceHeader: request.headers.get("x-workspace-id"), workspace },
    verifiedAccessToken
  );
  if (bearer && "refuse" in bearer) return NextResponse.json({ error: { code: bearer.refuse.code, message: bearer.refuse.message } }, { status: bearer.refuse.status });
  if (bearer) {
    request.cookies.set(SESSION_COOKIE, encodeSession(bearer.session));
    return NextResponse.next({ request });
  }

  if (session && secondsLeft(session) < RENEW_BEFORE_S) {
    try {
      const opened = await renew(session.refreshToken, workspace);
      session = opened.session;
      renewed = encodeSession(session);
      // The handlers of THIS request must see the new tokens too.
      request.cookies.set(SESSION_COOKIE, renewed);
      if (SESSION_COOKIE !== LEGACY_SESSION_COOKIE) request.cookies.delete(LEGACY_SESSION_COOKIE);
    } catch (e) {
      const refused = e instanceof BackofficeError && (e.status === 401 || e.status === 403);
      // Refused: signed out. An outage keeps the cookie, even past expiry: it is renewed once the back office answers.
      if (refused) {
        session = null;
        dropped = true;
        request.cookies.delete(SESSION_COOKIE);
        request.cookies.delete(LEGACY_SESSION_COOKIE);
      }
    }
  }

  let response: NextResponse;
  if (!session && !isPublicPath(pathname)) {
    if (pathname.startsWith("/api/")) {
      response = NextResponse.json({ error: { code: "unauthorized", message: "Sign in required" } }, { status: 401 });
    } else {
      const url = new URL("/login", loginOrigin(request));
      url.searchParams.set("next", pathname + request.nextUrl.search); // a shared link keeps its ?c= / ?s=
      response = NextResponse.redirect(url);
    }
  } else {
    response = NextResponse.next({ request });
  }

  if (renewed) response.cookies.set(SESSION_COOKIE, renewed, sessionCookieOptions);
  // The cookie's earlier name goes once its value lives under the new one, or is dropped.
  if ((renewed || dropped) && SESSION_COOKIE !== LEGACY_SESSION_COOKIE) response.cookies.delete(LEGACY_SESSION_COOKIE);
  if (dropped) response.cookies.delete(SESSION_COOKIE);
  return response;
}
