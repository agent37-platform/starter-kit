import "server-only";
import { echangesOn } from "@/lib/echanges";
import { eventStreamOn } from "@/lib/instance-events";

// Deployment configuration, read from the environment AT RUNTIME — never at build time.
//
// One Docker image serves every client: the back-office starts it with that client's env
// (SUPABASE_URL, SUPABASE_ANON_KEY, SITE_URL, …). Next.js inlines any literal
// `process.env.NEXT_PUBLIC_*` access into the bundle at build time, so this module only
// reads variables through a computed key, and it is the only place that reads them. The
// legacy NEXT_PUBLIC_* names are still honoured as a fallback for older .env.local files.
//
// The browser gets the public subset (`publicConfig()`) from the root layout via
// `PublicConfigProvider`; the service-role key never leaves the server.

function read(name: string, legacy?: string): string | undefined {
  const env = process.env;
  const value = env[name]?.trim() || (legacy ? env[legacy]?.trim() : undefined);
  return value || undefined;
}

export function supabaseUrl(): string | undefined {
  return read("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
}

export function supabaseAnonKey(): string | undefined {
  return read("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export function supabaseServiceRoleKey(): string | undefined {
  return read("SUPABASE_SERVICE_ROLE_KEY");
}

export function siteUrl(): string | undefined {
  return read("SITE_URL", "NEXT_PUBLIC_SITE_URL");
}

export function brandLogoUrl(): string | undefined {
  return read("BRAND_LOGO_URL");
}

// Yelema's Composio project key: the Connecteurs tab and the experts' tool proxy run on it.
// Server-only. Optional: without it, an instance wired for it answers "pas encore activés".
export function composioApiKey(): string | undefined {
  return read("COMPOSIO_API_KEY");
}

// The Yelema back office's public origin: it serves the expert catalogue (names, roles, photos,
// videos). Optional: without it the app still works and shows each expert by its profile name.
export function backofficeUrl(): string | undefined {
  return read("BACKOFFICE_URL")?.replace(/\/+$/, "");
}

// The client workspace this deployment serves. Every client shares ONE Supabase project (see
// docs/decisions/supabase-projet-partage.md), so the deployment is pinned to its workspace: any
// other workspace — even one the signed-in user belongs to — is invisible here. Unset means the
// legacy dedicated-project mode, where the database holds a single workspace anyway.
export function deploymentWorkspaceId(): string | undefined {
  return read("WORKSPACE_ID");
}

// The secret this app shows the back office to ask which client a host belongs to. Server-only.
export function resolverToken(): string | undefined {
  return read("APP_RESOLVER_TOKEN");
}

// One deployment for every client: no WORKSPACE_ID, and what the resolver needs. The client of a
// request is then the one its host belongs to (src/lib/tenant.ts). With WORKSPACE_ID the deployment
// serves that one client, as before, so the same version runs in both set-ups.
export function multiTenant(): boolean {
  return !deploymentWorkspaceId() && Boolean(backofficeUrl()) && Boolean(resolverToken());
}

// The version this deployment runs: the git tag the back office deployed (APP_VERSION), else the
// ref Vercel built, else "dev" locally.
// Who signs users in and says what they may see. "backoffice": the Yelema back office does, through
// its /api/v1/app routes (src/lib/backoffice.ts), and this app no longer asks Supabase who the user
// is. It takes the switch AND the two settings those routes need; otherwise the app keeps its
// first way (Supabase Auth and its own tables), so a deployment can be moved, and moved back, by
// redeploying with one variable. A deployment that serves every client knows only the back office's way.
export function authViaBackoffice(): boolean {
  if (multiTenant()) return true;
  return read("AUTH_VIA_BACKOFFICE") === "true" && Boolean(backofficeUrl()) && Boolean(deploymentWorkspaceId());
}

export function appVersion(): string {
  return read("APP_VERSION") ?? read("VERCEL_GIT_COMMIT_REF") ?? "dev";
}

// One value per deployment, so an open page can tell it now runs an older one. The commit ref above
// is a branch or a tag, which a redeploy of the same tag would not change.
export function deployVersion(): string {
  return read("VERCEL_DEPLOYMENT_ID") ?? read("VERCEL_GIT_COMMIT_SHA") ?? appVersion();
}

// Names of the required variables that are unset. Used by /api/health, which reports only
// whether the deployment is complete — never which values it holds.
export function missingRequired(): string[] {
  const required: [string, string | undefined][] = [
    // Behind the runtime gateway the app never calls Agent37 itself: no key to hold (sensitive clients).
    ["AGENT37_API_KEY", read("AGENT37_API_KEY") ?? (read("RUNTIME_GATEWAY_URL") && read("RUNTIME_GATEWAY_TOKEN") ? "gateway" : undefined)],
    ["SUPABASE_URL", supabaseUrl()],
    ["SUPABASE_ANON_KEY", supabaseAnonKey()],
    ["SUPABASE_SERVICE_ROLE_KEY", supabaseServiceRoleKey()],
  ];
  // One deployment for every client has no address of its own: each request brings its host.
  if (!multiTenant()) required.push(["SITE_URL", siteUrl()]);
  return required.filter(([, value]) => !value).map(([name]) => name);
}

// What the browser needs: Supabase Auth runs client-side with the anon key, which is public
// by design (the tables are granted to the service role only).
export function echangesVisible(): boolean {
  return echangesOn(read("ECHANGES"));
}

export type PublicConfig = {
  // "backoffice": the pages sign in through this app's /api/auth routes, not Supabase.
  authVia: "supabase" | "backoffice";
  supabaseUrl: string;
  supabaseAnonKey: string;
  siteUrl: string | null;
  logoUrl: string | null;
  /** The instance's event stream is open (EVENT_STREAM=on and the gateway): polls wait for it. */
  eventStream: boolean;
  /** Échanges (messagerie entre membres) shown: `ECHANGES=on` on the Vercel project (pilot only for now). */
  echanges: boolean;
};

// Signed in through the back office, the browser never talks to Supabase: it gets neither value.
export function publicConfig(): PublicConfig {
  const viaBackoffice = authViaBackoffice();
  return {
    authVia: viaBackoffice ? "backoffice" : "supabase",
    supabaseUrl: viaBackoffice ? "" : (supabaseUrl() ?? ""),
    supabaseAnonKey: viaBackoffice ? "" : (supabaseAnonKey() ?? ""),
    siteUrl: siteUrl() ?? null,
    logoUrl: brandLogoUrl() ?? null,
    eventStream: eventStreamOn(process.env),
    echanges: echangesVisible(),
  };
}
