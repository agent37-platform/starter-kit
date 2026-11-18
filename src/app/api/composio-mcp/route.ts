import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { instanceFetch } from "@/lib/agent37";
import { backoffice, BackofficeError, type ComposioCallsDeclaration } from "@/lib/backoffice";
import { composioUserId, hashAppsToken, mintMcpSession, stageFile, type McpSession } from "@/lib/composio";
import { pinnedAccounts } from "@/lib/connection-accounts";
import { extractComposioCalls } from "@/lib/composio-usage";
import { formatEmailCalls } from "@/lib/composio-email";
import { fetchUntilHeaders } from "@/lib/fetch-timeout";
import {
  addBridgeTool,
  bridgeAnswer,
  bridgeCall,
  bridgePath,
  bridgeToolSlug,
  fileNameOf,
  isToolsList,
  MAX_BRIDGE_BYTES,
  mimeOf,
  toolkitOf,
} from "@/lib/livrables-bridge";
import { memo } from "@/lib/memo";
import { backofficeUrl } from "@/lib/runtime-config";
import { pinnedWorkspaceId } from "@/lib/tenant";
import { TenantError } from "@/lib/tenant-resolver";

// The MCP proxy between the experts and Yelema's Composio: the only place their tool traffic meets
// the key. Each instance's Hermes has an `apps` MCP server pointed here with its own Bearer token
// (the yelema-hermes image writes it into every profile from ~/.yelema/apps-mcp.json). The token
// maps to the instance, and the request is forwarded to a Composio tool session scoped to the
// MEMBER who owns it, so an expert only ever reaches its own member's connected accounts. Every
// client shares one database, so a token of another client's workspace is refused here too.
// Each tool execution that goes through is declared to the back office, which prices and stores it:
// by name only, and never in the expert's way (see declareCalls).
// Adapted from agent37-platform/hermes-openclaw-composio.
export const maxDuration = 300;

const FORWARD_REQUEST_HEADERS = ["content-type", "accept", "mcp-session-id", "mcp-protocol-version", "last-event-id"] as const;
const FORWARD_RESPONSE_HEADERS = ["content-type", "mcp-session-id", "mcp-protocol-version"] as const;

// One Composio session per member and set of default accounts, minted once per server instance and reused until
// Composio answers 404 (evicted) or 401 (key changed); then it is re-minted and the request replayed once.
const sessions = memo<McpSession>({ ttlMs: 12 * 60 * 60_000, maxEntries: 500, maxFlightMs: 30_000 });
const sessionKey = (userId: string, pins: Record<string, string[]>) => `${userId}|${JSON.stringify(pins)}`;

function getSession(userId: string, pins: Record<string, string[]>): Promise<McpSession> {
  // A pin Composio refuses (account gone since) must not cost the expert its tools: unpinned then.
  return sessions.get(sessionKey(userId, pins), () => mintMcpSession(userId, pins).catch((e) => (Object.keys(pins).length ? mintMcpSession(userId) : Promise.reject(e))));
}

// The member's default account per tool, chosen on the Intégrations screen and kept by the back office. Read
// at most once a minute per instance (and agent); the last answer stands while the back office is away.
const pinsCache = memo<Record<string, string[]>>({ ttlMs: 60_000, staleOnErrorMs: 6 * 60 * 60_000, maxEntries: 2000, maxFlightMs: 20_000 });

async function defaultPins(token: string, workspace: string, profile: string | null): Promise<Record<string, string[]>> {
  if (!backofficeUrl()) return {};
  try {
    return await pinsCache.get(`${hashAppsToken(token)}|${profile ?? ""}`, async () => pinnedAccounts((await backoffice.appsAccounts(token, workspace, profile ?? undefined)).defaults ?? {}));
  } catch (e) {
    // 404: a back office without the route yet. Anything else is kept quiet past the first line.
    if (!(e instanceof BackofficeError && e.status === 404)) console.warn("[composio-mcp] default accounts unavailable:", e instanceof Error ? e.message : e);
    return {};
  }
}

type TokenRow = { agent37_id: string; workspace_id: string; owner_user_id: string | null };
// The instance an apps token belongs to: kept a minute (an unknown token 10 s), a database outage never kept.
const tokenRows = memo<TokenRow | null>({ ttlMs: 60_000, ttlOf: (row) => (row ? 60_000 : 10_000), maxEntries: 2000, maxFlightMs: 15_000 });
class LookupDown extends Error {}

function rowOfToken(token: string): Promise<TokenRow | null> {
  const hash = hashAppsToken(token);
  return tokenRows.get(hash, async () => {
    const { data, error } = await createAdminClient()
      .from("agents")
      .select("agent37_id, workspace_id, owner_user_id")
      .eq("apps_token_hash", hash)
      .maybeSingle<TokenRow>();
    if (error) throw new LookupDown(error.message);
    return data ?? null;
  });
}

// Upstream answers its headers once the tool has run; the body may then stream.
const FORWARD_HEADERS_TIMEOUT_MS = 150_000;

function forward(session: McpSession, request: Request, body: ArrayBuffer | undefined): Promise<Response> {
  const headers: Record<string, string> = { ...session.headers };
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  // redirect: "manual", or fetch would carry the Composio key across a cross-origin redirect.
  return fetchUntilHeaders(session.url, {
    method: request.method,
    headers,
    body: request.method === "POST" ? body : undefined,
    redirect: "manual",
    cache: "no-store",
  }, FORWARD_HEADERS_TIMEOUT_MS);
}

function errorJson(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

const RETRY_DELAY_MS = 1_000;

// Tells the back office which tools this request executed. Started once Composio has answered and
// never awaited: the answer streams to the expert meanwhile, and nothing that happens here reaches
// it. A declaration that does not get through is lost; there is no queue.
function declareCalls(token: string, row: { agent37_id: string; workspace_id: string }, body: ArrayBuffer | undefined, httpStatus: number): void {
  if (!body || !backofficeUrl()) return;
  const occurredAt = new Date().toISOString();
  const sent = (async () => {
    // Let the answer leave first: a large body takes a moment to read.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const calls = extractComposioCalls(new TextDecoder().decode(body));
    if (calls.length === 0) return;
    // Fixed once: a second try must carry the same id and the same calls to be counted once.
    const declaration: ComposioCallsDeclaration = { requestId: randomUUID(), occurredAt, httpStatus, calls };
    for (let attempt = 1; ; attempt++) {
      try {
        await backoffice.reportComposioCalls(token, row.workspace_id, declaration);
        return;
      } catch (e) {
        const status = e instanceof BackofficeError ? e.status : 0;
        // Only an outage is worth a second try; the back office's own refusals are final.
        if ((status === 0 || status >= 500) && attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }
        const what = `[composio-mcp] ${row.agent37_id}: ${calls.length} tool call(s) not recorded (${status || "error"})`;
        // A refused body is ours to fix: the extraction let something out of the back office's bounds.
        if (status === 400) console.error(`${what}: declaration refused, check extractComposioCalls`);
        // 401 is expected while an instance is being rewired, 404 from a back office without the route.
        else console.warn(what);
        return;
      }
    }
  })().catch(() => {});
  try {
    // Keeps the function alive until the declaration is in, where the host would otherwise freeze it.
    after(() => sent);
  } catch {
    // Outside a request there is nothing to keep alive.
  }
}

// The Livrables bridge (src/lib/livrables-bridge.ts): a file of the instance's drive staged in Composio's
// storage for the tool the expert names, answered as the { name, mimetype, s3key } that tool takes.
// Answered here, never forwarded: Composio does not know the tool. The path is checked before it
// reaches the instance (the files API reads anything there, keys included).
const BRIDGE_READ_TIMEOUT_MS = 60_000;

async function runBridge(agentId: string, args: Record<string, unknown>, id: unknown) {
  const path = bridgePath(args.chemin);
  if (!path) return bridgeAnswer(id, { ok: false, message: "Chemin refusé : donne le chemin d'un fichier de tes Livrables, par exemple ~/Livrables/<ton prénom>/devis.pdf." });
  const tool = bridgeToolSlug(args.outil);
  if (!tool) return bridgeAnswer(id, { ok: false, message: "Donne le nom exact de l'outil qui recevra le fichier, par exemple GOOGLEDRIVE_UPLOAD_FILE ou GMAIL_SEND_EMAIL." });
  const tooBig = bridgeAnswer(id, { ok: false, message: "Ce fichier dépasse 25 Mo : trop lourd pour être joint. Dépose un lien vers un document Google à la place." });
  try {
    const qs = new URLSearchParams({ path, disposition: "attachment" });
    const res = await instanceFetch(agentId, `/v1/files/content?${qs}`, { signal: AbortSignal.timeout(BRIDGE_READ_TIMEOUT_MS) });
    if (res.status === 404) return bridgeAnswer(id, { ok: false, message: `Fichier introuvable : ${path}. Liste le dossier pour avoir le nom exact, puis réessaie.` });
    if (!res.ok) {
      console.warn(`[composio-mcp] ${agentId}: bridge read ${res.status}`);
      return bridgeAnswer(id, { ok: false, message: "Le fichier n'a pas pu être lu dans tes Livrables. Réessaie dans un instant." });
    }
    if (Number(res.headers.get("content-length")) > MAX_BRIDGE_BYTES) return tooBig;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_BRIDGE_BYTES) return tooBig;
    if (bytes.byteLength === 0) return bridgeAnswer(id, { ok: false, message: `Le fichier ${path} est vide.` });
    const name = fileNameOf(path);
    const file = await stageFile(bytes, name, mimeOf(name, res.headers.get("content-type")), tool, toolkitOf(tool));
    return bridgeAnswer(id, { ok: true, file });
  } catch (e) {
    console.warn(`[composio-mcp] ${agentId}: bridge failed:`, e instanceof Error ? e.message : e);
    return bridgeAnswer(id, { ok: false, message: "Le fichier n'a pas pu être préparé pour l'outil. Réessaie dans un instant." });
  }
}

// Chat d'entreprise: the enterprise instance has no agents row; its agent (`u-…`, header X-Yelema-Profile)
// reaches the apps of ITS member, whom the back office names from the instance token. Unknown agent: no row.
const SEAT_PROFILE = /^u-[a-z0-9]{6}$/;
const seats = memo<TokenRow | null>({ ttlMs: 60_000, ttlOf: (row) => (row ? 60_000 : 10_000), maxEntries: 2000, maxFlightMs: 20_000 });

async function seatRow(token: string, workspace: string | undefined, header: string | null): Promise<TokenRow | Response | null> {
  const profile = header?.trim() ?? "";
  if (!workspace || !SEAT_PROFILE.test(profile)) return null;
  try {
    return await seats.get(`${hashAppsToken(token)}|${workspace}|${profile}`, async () => {
      try {
        const { user } = await backoffice.seatAppsUser(token, workspace, profile);
        return { agent37_id: profile, workspace_id: workspace, owner_user_id: user };
      } catch (e) {
        if (e instanceof BackofficeError && e.status >= 400 && e.status < 500) return null;
        throw e;
      }
    });
  } catch {
    return errorJson(503, "token lookup unavailable");
  }
}

async function handle(request: Request): Promise<Response> {
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]?.trim();
  if (!token) return errorJson(401, "missing bearer token");

  // The client this address belongs to: the deployment's, or the one of the host that was called.
  let pinned: string | undefined;
  try {
    pinned = await pinnedWorkspaceId();
  } catch (e) {
    // An outage must not look like a revoked token; a host that is no client's has no valid token.
    return e instanceof TenantError && e.status < 500 ? errorJson(401, "invalid token") : errorJson(503, "token lookup unavailable");
  }

  // An enterprise seat names itself: no agents row to look up.
  const seatHeader = request.headers.get("x-yelema-profile");
  const isSeat = SEAT_PROFILE.test(seatHeader?.trim() ?? "");
  let found: TokenRow | null = null;
  if (!isSeat) {
    try {
      found = await rowOfToken(token);
    } catch {
      // A database outage must not look like a revoked token to the expert.
      return errorJson(503, "token lookup unavailable");
    }
  }
  const row = found ?? (await seatRow(token, pinned, seatHeader));
  if (row instanceof Response) return row;
  if (!row) return errorJson(401, "invalid token");
  // An instance of another client than this address's is not ours to proxy.
  if (pinned && row.workspace_id !== pinned) return errorJson(401, "invalid token");
  const userId = composioUserId(row);
  const seat = found ? null : (request.headers.get("x-yelema-profile")?.trim() ?? null);
  const pins = await defaultPins(token, row.workspace_id, seat);

  const raw = request.method === "POST" ? await request.arrayBuffer() : undefined;
  const text = raw ? new TextDecoder().decode(raw) : "";
  // An e-mail sent through the client's Gmail or Outlook leaves formatted, never as raw text.
  const formatted = text ? formatEmailCalls(text) : null;
  const body = formatted ? (new TextEncoder().encode(formatted).buffer as ArrayBuffer) : raw;
  // The bridge reads the expert's own instance: an enterprise seat has no instance of its own here.
  const bridge = text ? bridgeCall(text) : null;
  if (bridge) {
    const answer = found
      ? await runBridge(row.agent37_id, bridge.args, bridge.id)
      : bridgeAnswer(bridge.id, { ok: false, message: "Cet outil n'est pas disponible dans le chat d'entreprise." });
    return Response.json(answer, { headers: { "cache-control": "no-store" } });
  }
  try {
    let upstream = await forward(await getSession(userId, pins), request, body);
    if (upstream.status === 404 || upstream.status === 401) {
      sessions.drop(sessionKey(userId, pins));
      upstream = await forward(await getSession(userId, pins), request, body);
    }
    // Once per request, with the final status: a replay after a stale session is not a second call.
    declareCalls(token, row, body, upstream.status);
    if (upstream.status >= 300 && upstream.status < 400) return errorJson(502, "upstream redirect refused");

    const headers = new Headers();
    for (const name of FORWARD_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    // The tool list gets the bridge (an expert's instance only): read whole, it is a short answer.
    if (found && upstream.ok && isToolsList(text)) {
      return new Response(addBridgeTool(await upstream.text(), upstream.headers.get("content-type")), { status: upstream.status, headers });
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (e) {
    console.warn(`[composio-mcp] ${row.agent37_id} proxy failed:`, e instanceof Error ? e.message : e);
    return errorJson(502, "composio upstream unavailable");
  }
}

export { handle as POST, handle as DELETE };

// The optional standalone GET stream (server push) is refused: every MCP client opens it at connect
// and holds it, which would park one serverless function per expert for a channel nothing uses.
// It must stay a clean 405; a stream accepted then closed sends MCP clients into a reconnect loop.
export function GET(): Response {
  return new Response(null, { status: 405, headers: { allow: "POST, DELETE" } });
}
