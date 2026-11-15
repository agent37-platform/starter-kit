import "server-only";
import { coldStartWait } from "./cold-start";
import type { DriveTree } from "./drive-paths";
import { EXEC_TIMEOUT_MS, JSON_TIMEOUT_MS, withTimeout } from "./fetch-timeout";
import { authViaBackoffice } from "./runtime-config";
import type { RunOutcome } from "./routines";
import { gatewayFetch, gatewayInstancePath, gatewayPortHeaders, runtimeGateway, type RuntimeGateway } from "./runtime-gateway";
import type {
  Agent,
  Budget,
  FileEntry,
  FileListResponse,
  IntegrationConnectionsResult,
  IntegrationConnectResult,
  IntegrationToolkitsResult,
  ModelsResponse,
  SessionDetail,
  SessionListResponse,
  Template,
  Usage,
} from "@/lib/types";

// The Hosting API base (control plane). A code constant, not an env var — there's no
// per-deployment reason to change it (point it elsewhere only for local API work, by editing here).
const BASE = "https://api.agent37.com";

// The per-instance Agents API (the DATA plane — chat /v1/responses, /v1/models, /v1/sessions,
// /v1/files) is served on the INSTANCE host: the bare `https://{id}.agent37.app` (default port
// 3737), NOT the control-plane BASE above (which owns instance lifecycle: start/stop/exec/etc).
// Like BASE, a code constant — no per-deployment reason to change it.
const INSTANCE_DOMAIN = "agent37.app";

// Any other port of the instance has its own preview host, `https://{id}-{port}.agent37.app`,
// behind the same key (https://www.agent37.com/docs/agents-api/urls).
// Every id this module puts in a URL or a host name goes through here. The key sent with the call
// is workspace-wide, so an id carrying "../" or a dot would aim it at another resource
// (DELETE /v1/instances/<id>) or another host: only the plain form Agent37 and Composio hand out
// is let through, anything else is refused before the request is made.
const URL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function urlId(value: string): string {
  if (typeof value !== "string" || !URL_ID.test(value)) {
    throw new Agent37Error(400, "invalid_request", "Invalid identifier");
  }
  return value;
}

function instanceBaseUrl(id: string, port?: number): string {
  const suffix = port === undefined ? "" : `-${Math.trunc(port)}`;
  return `https://${urlId(id)}${suffix}.${INSTANCE_DOMAIN}`;
}

/**
 * The Telegram of an instance, as the runtime gateway publishes it; `state: null` = no bot being set up or
 * connected through it. `source`: the Yelema bot (absent) or the member's BotFather bot (`own`). `active`: that
 * bot is the one the instance's runtime listens to; `instanceBot`: the one it listens to, whatever its source.
 */
export type TelegramHubStatus = {
  connected: boolean;
  state: {
    phase: "awaiting_group" | "needs_topics" | "ready" | "failed";
    source?: "yelema" | "own";
    botId: number;
    bot: string;
    chatTitle?: string;
    topics?: Record<string, string>;
    inviteLink?: string | null;
    groupUrl?: string;
    error?: string;
    active?: boolean;
  } | null;
  instanceBot?: { id: number; username: string | null } | null;
  /** The manager bot's link while no bot exists yet; `started`: Telegram received its /start. */
  link?: { url: string; expiresAt: string; started: boolean };
};

export type RelayChannel = "slack" | "teams" | "telegram";
/** `createUrl` : Telegram d'une équipe sans bot encore, le lien qui fait créer le bot de l'espace (premier membre). */
export type RelayLink = { code?: string; expiresAt?: string; installUrl?: string; appUrl?: string | null; botUrl?: string; createUrl?: string };
export type RelayStatus = { enabled: boolean; accounts: number; bot?: string | null };

const relayPath = (channel: RelayChannel): string => (channel === "telegram" ? "telegram-relay" : channel);

// The gateway's own JSON routes (Telegram, relays, capabilities, pack files): never a stream.
const gatewayJson = (gw: RuntimeGateway, path: string, init?: RequestInit) => gatewayFetch(gw, path, withTimeout(init, JSON_TIMEOUT_MS));

function requireGateway(): RuntimeGateway {
  const gw = runtimeGateway();
  if (!gw) throw new Agent37Error(501, "unsupported", "Telegram for this runtime needs the runtime gateway");
  return gw;
}

export type RuntimeCapabilities = { runtime: string; profiles: string[]; active: boolean; capabilities: string[] };

export class Agent37Error extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "Agent37Error";
    this.status = status;
    this.code = code;
  }
}

// Read a JSON response from either Agent37 surface (control-plane or instance) and throw a
// typed Agent37Error on non-2xx. Errors come back nested ({"error":{...}}) or flat; unwrap so
// the real message survives. `augment402` adds the billing hint that only create/start hits.
async function parseAgent37<T>(res: Response, augment402 = false): Promise<T> {
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!res.ok) {
    const raw = (data ?? {}) as {
      code?: string;
      message?: string;
      error?: string | { code?: string; message?: string };
    };
    // Some surfaces (integrations, data-plane transport errors) answer with a flat string
    // error ({"error":"custom_auth_required"}); treat it as both code and message.
    const err =
      typeof raw.error === "string" ? { code: raw.error, message: raw.error } : raw.error ?? raw;
    let message = err.message || res.statusText;
    if (augment402 && res.status === 402) {
      // Almost always an unfunded wallet. For the operator reading the server log: the member is
      // never shown an Agent37Error's message (see handleError in lib/http).
      message = `${message} (Agent37 payment required — fund your wallet under Cloud → Billing in the dashboard, then retry.)`;
    }
    throw new Agent37Error(res.status, err.code || "error", message);
  }

  return data as T;
}

// The signed-in account, named to the runtime gateway: on an enterprise instance it picks that member's
// agent and confines the call to it. Outside a request (no session), nothing is added.
async function asUser(init: RequestInit): Promise<RequestInit> {
  const id = await (authViaBackoffice()
    ? import("./session").then((m) => m.currentUserId())
    : import("./auth").then((m) => m.getSession()).then((s) => s.user?.id ?? null)
  ).catch(() => null);
  if (!id) return init;
  const headers = new Headers(init.headers);
  if (!headers.has("X-Yelema-User")) headers.set("X-Yelema-User", id);
  return { ...init, headers };
}

// `gatewayPath`: the same call on the runtime gateway; absent = not offered there.
async function call<T>(path: string, init?: RequestInit, gatewayPath?: string, timeoutMs = JSON_TIMEOUT_MS): Promise<T> {
  const gw = runtimeGateway();
  init = withTimeout(init, timeoutMs);
  if (gw) {
    if (!gatewayPath) throw new Agent37Error(501, "unsupported", `${path} is not offered by the runtime gateway`);
    const res = await gatewayFetch(gw, gatewayPath, await asUser({ ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } }));
    return parseAgent37<T>(res, true);
  }
  const key = process.env.AGENT37_API_KEY;
  if (!key) {
    throw new Agent37Error(500, "config_error", "AGENT37_API_KEY is not set on the server");
  }

  const res = await fetch(`${BASE}/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  return parseAgent37<T>(res, true);
}

// Raw fetch against an instance's Agents API (data plane), authenticated with the raw key in the
// X-Agent37-Key header (the data plane passes Authorization through to the app). Returns the raw
// Response so callers can stream SSE, upload bytes, or stream a download — things the JSON-parsing
// `call` helper above can't. Only throws for missing server config; HTTP status is the caller's to
// handle (e.g. a 409 session_busy is surfaced, not thrown here).
//
// A ReadableStream request body is buffered to an ArrayBuffer first: a stream has no known length,
// so undici would send `Transfer-Encoding: chunked`, and the instance-host proxy in front of the
// gateway drops chunked request bodies — the write would land as a 0-byte file. Buffering gives it a
// known length so undici sets Content-Length and the proxy frames it correctly. Sized bodies
// (Blob/string/ArrayBuffer) already carry a length and pass straight through. Forwarded uploads are
// bounded by the edge's upload envelope, so the buffer stays small.
export async function instanceFetch(id: string, path: string, init?: RequestInit): Promise<Response> {
  const body = init?.body instanceof ReadableStream ? await new Response(init.body).arrayBuffer() : init?.body;
  const gw = runtimeGateway();
  // The gateway mirrors the instance's paths under /v1/instances/{id}/ (same verbs, same bodies).
  if (gw) {
    if (!path.startsWith("/v1/")) throw new Agent37Error(400, "invalid_request", "Invalid instance path");
    return gatewayFetch(gw, gatewayInstancePath(urlId(id), path), await asUser({ ...init, body }));
  }
  const key = process.env.AGENT37_API_KEY;
  if (!key) {
    throw new Agent37Error(500, "config_error", "AGENT37_API_KEY is not set on the server");
  }
  return fetch(`${instanceBaseUrl(id)}${path}`, {
    ...init,
    body,
    headers: { "X-Agent37-Key": key, ...(init?.headers || {}) },
    cache: "no-store",
  });
}

// Raw fetch against another port of the instance, through its preview URL. Here it is how the
// Routines tab reaches Hermes's API server (lib/hermes-cron), which checks its own Bearer key: the
// edge passes Authorization through untouched. JSON bodies only.
export async function instancePortFetch(id: string, port: number, path: string, init?: RequestInit): Promise<Response> {
  if (!init?.signal) init = withTimeout(init, JSON_TIMEOUT_MS);
  const gw = runtimeGateway();
  if (gw) {
    return gatewayFetch(gw, `/v1/instances/${urlId(id)}/ports/${Math.trunc(port)}${path}`, await asUser({ ...init, headers: gatewayPortHeaders(init?.headers) }));
  }
  const key = process.env.AGENT37_API_KEY;
  if (!key) {
    throw new Agent37Error(500, "config_error", "AGENT37_API_KEY is not set on the server");
  }
  return fetch(`${instanceBaseUrl(id, port)}${path}`, {
    ...init,
    headers: { "X-Agent37-Key": key, ...(init?.headers || {}) },
    cache: "no-store",
  });
}

// JSON helper against an instance's Agents API — same parse + Agent37Error semantics as `call`,
// without the 402 wallet hint (a data-plane 402 is budget exhaustion mid-chat, not wallet funding).
async function instanceCall<T>(id: string, path: string, init?: RequestInit): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const res = await instanceFetch(id, path, withTimeout({
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    }, JSON_TIMEOUT_MS));
    const wait = coldStartWait(init?.method, res.status, attempt);
    if (wait === null) return parseAgent37<T>(res);
    await res.body?.cancel();
    await new Promise((r) => setTimeout(r, wait));
  }
}

// Reads, and the instance's own surfaces (chat, files, exec, one signed URL). Nothing here creates,
// deletes, starts, stops, updates, resizes or re-budgets an instance: those are the back office's,
// and an app holding the workspace-wide key must not be able to do them for a signed-in user.
export const agent37 = {
  // The Agent37 account is shared by every Yelema client: the gateway only lists this workspace's.
  listAgents: (workspaceId: string) =>
    call<{ data: Agent[] }>("/instances", undefined, `/v1/control/instances?workspace=${encodeURIComponent(workspaceId)}`),
  getAgent: (id: string) => call<Agent>(`/instances/${urlId(id)}`, undefined, `/v1/instances/${urlId(id)}/agent`),
  // Run a shell command inside the instance. The escape hatch for anything the API does not wrap as
  // its own call. Here it is how the Messaging tab reaches the harness's own messaging API, which
  // listens on a loopback port inside the sandbox. A command that exits nonzero is a normal 200 with
  // its exit_code, so read that rather than relying on a throw.
  exec: (id: string, command: string, user?: "root") =>
    call<{ exit_code: number; stdout: string; stderr: string; truncated: boolean }>(
      `/instances/${urlId(id)}/exec`,
      { method: "POST", body: JSON.stringify({ command, ...(user ? { user } : {}) }) },
      `/v1/instances/${urlId(id)}/exec`,
      EXEC_TIMEOUT_MS
    ),

  signedUrl: (id: string, port: number, ttlSeconds?: number) =>
    call<{ url: string; domain_urls?: string[]; port: number; expires_at: number }>(
      `/instances/${urlId(id)}/signed-url`,
      { method: "POST", body: JSON.stringify({ port, ...(ttlSeconds ? { ttl_seconds: ttlSeconds } : {}) }) },
      `/v1/instances/${urlId(id)}/signed-url`
    ),

  listTemplates: () => call<{ data: Template[] }>("/templates", undefined, "/v1/control/templates"),

  // ---- Per-instance Agents API (data plane: web chat) — served on the instance host, see
  // instanceFetch. The streaming surfaces (POST /v1/responses SSE, GET/PUT /v1/files/content,
  // GET /v1/files/archive) go through instanceFetch directly from their routes. ----
  // `profileQuery` is the "?profile=…" of one Hermes profile (see lib/profile-id), empty for the
  // instance's default home. Every session read below takes it too.
  listModels: (id: string, profileQuery = "") => instanceCall<ModelsResponse>(id, `/v1/models${profileQuery}`),
  // The thread rail: every session on the instance. Items carry `title`, a `preview` of the first
  // message, and timestamps — the sessions route turns these into the rail's label + ordering.
  listSessions: (id: string, profileQuery = "") =>
    instanceCall<SessionListResponse>(id, `/v1/sessions${profileQuery}`),
  // `asOwner`: read as the conversation's owner (a shared link opened by a colleague), not as the caller.
  getSession: (id: string, sessionId: string, profileQuery = "", asOwner?: string) =>
    instanceCall<SessionDetail>(id, `/v1/sessions/${encodeURIComponent(sessionId)}${profileQuery}`, asOwner ? { headers: { "X-Yelema-User": asOwner } } : undefined),
  deleteSession: (id: string, sessionId: string, profileQuery = "") =>
    instanceCall<{ id: string; deleted: boolean }>(
      id,
      `/v1/sessions/${encodeURIComponent(sessionId)}${profileQuery}`,
      { method: "DELETE" }
    ),
  // Set a session's title. Supported on newer Hermes builds; older ones answer 404/405 (the
  // PATCH route maps that to a friendly "not supported yet" so the rail degrades gracefully).
  renameSession: (id: string, sessionId: string, title: string, profileQuery = "") =>
    instanceCall<{ id: string; agent: string; renamed: boolean }>(
      id,
      `/v1/sessions/${encodeURIComponent(sessionId)}${profileQuery}`,
      { method: "PATCH", body: JSON.stringify({ title }) }
    ),
  cancelResponse: (id: string, responseId: string) =>
    instanceCall<{ id: string; status: string }>(
      id,
      `/v1/responses/${encodeURIComponent(responseId)}/cancel`,
      { method: "POST" }
    ),
  // Add a message to a running turn (yelema-hermes ≥ v1.7.0; older images answer 404).
  steerResponse: (id: string, responseId: string, text: string, key?: string) =>
    instanceCall<{ id: string; accepted: boolean }>(
      id,
      `/v1/responses/${encodeURIComponent(responseId)}/steer`,
      { method: "POST", body: JSON.stringify({ text, ...(key ? { client_message_id: key } : {}) }) }
    ),

  // ---- Per-instance file browser (Agents API /v1/files) — JSON surfaces only. The byte surfaces
  // (GET/PUT /v1/files/content, GET /v1/files/archive) stream and so go through instanceFetch. ----
  // List one directory level. Omit `path` for the agent's default workspace dir. Upstream typed
  // errors (e.g. not_a_directory) ride back as Agent37Error and keep their code/status.
  listFiles: (id: string, path?: string) =>
    instanceCall<FileListResponse>(id, `/v1/files${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  // The drive walked by the runtime gateway (same shape as /api/agents/[id]/files/tree); 404 where not deployed.
  fileTree: async (id: string, root: string, depth: number): Promise<DriveTree> => {
    if (!runtimeGateway()) throw new Agent37Error(404, "not_found", "No runtime gateway");
    return instanceCall<DriveTree>(id, `/v1/files/tree?root=${encodeURIComponent(root)}&depth=${Math.trunc(depth)}`);
  },
  // Recursive force delete (rm -rf, no guards); removes a symlink itself rather than following it.
  deleteFile: (id: string, path: string) =>
    instanceCall<{ ok: boolean }>(id, `/v1/files?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
  // Rename/move via fs.rename; returns the resolved FileEntry of the new path.
  moveFile: (id: string, from: string, to: string) =>
    instanceCall<FileEntry>(id, "/v1/files", { method: "PATCH", body: JSON.stringify({ from, to }) }),
  // mkdir -p (recursive, idempotent); returns the resolved FileEntry of the directory.
  makeDir: (id: string, path: string) =>
    instanceCall<FileEntry>(id, `/v1/files/dir?path=${encodeURIComponent(path)}`, { method: "POST" }),

  // App integrations (managed Composio, per-instance entity). Management ops only — no billing here.
  listIntegrationToolkits: (id: string, opts: { search?: string } = {}) => {
    const q = opts.search ? `?search=${encodeURIComponent(opts.search)}` : "";
    return call<IntegrationToolkitsResult>(`/instances/${urlId(id)}/integrations/toolkits${q}`, undefined, `/v1/instances/${urlId(id)}/integrations/toolkits${q}`);
  },
  connectIntegration: (id: string, body: { toolkit: string; alias?: string }) =>
    call<IntegrationConnectResult>(
      `/instances/${urlId(id)}/integrations/connect`,
      { method: "POST", body: JSON.stringify(body) },
      `/v1/instances/${urlId(id)}/integrations/connect`
    ),
  listIntegrationConnections: (id: string) =>
    call<IntegrationConnectionsResult>(`/instances/${urlId(id)}/integrations/connections`, undefined, `/v1/instances/${urlId(id)}/integrations/connections`),
  disconnectIntegration: (id: string, connectedAccountId: string) =>
    call<{ id: string; deleted: boolean }>(
      `/instances/${urlId(id)}/integrations/connections/${urlId(connectedAccountId)}`,
      { method: "DELETE" },
      `/v1/instances/${urlId(id)}/integrations/connections/${urlId(connectedAccountId)}`
    ),

  // A file an expert's pack ships (e.g. outils-recommandes.json), wherever its runtime keeps it: the
  // gateway knows the expert's folder; direct, it is the Hermes profile. Raw response, 404 = no file.
  expertFile: (id: string, profile: string, name: string) => {
    const gw = runtimeGateway();
    if (gw) return gatewayJson(gw, `/v1/instances/${urlId(id)}/experts/${urlId(profile)}/files/${encodeURIComponent(name)}`);
    return instanceFetch(id, `/v1/files/content?path=${encodeURIComponent(`~/.hermes/profiles/${profile}/${name}`)}`, withTimeout(undefined, JSON_TIMEOUT_MS));
  },

  // Telegram of an instance (Hermes or Claude Code), through the runtime gateway: a t.me link that has the
  // member create their own bot, then its forum group with one topic per expert.
  telegramHub: {
    link: async (id: string, name: string): Promise<{ url: string; groupUrl?: string; expiresAt: string }> =>
      parseAgent37(await gatewayJson(requireGateway(), `/v1/instances/${urlId(id)}/telegram/link`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) })),
    status: async (id: string): Promise<TelegramHubStatus> => parseAgent37(await gatewayJson(requireGateway(), `/v1/instances/${urlId(id)}/telegram`)),
    own: async (id: string, token: string): Promise<{ bot: string; groupUrl: string }> =>
      parseAgent37(await gatewayJson(requireGateway(), `/v1/instances/${urlId(id)}/telegram/own`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })),
    sync: async (id: string): Promise<{ ok: true; topics: number }> => parseAgent37(await gatewayJson(requireGateway(), `/v1/instances/${urlId(id)}/telegram/sync`, { method: "POST" })),
    disconnect: async (id: string): Promise<{ ok: true }> => parseAgent37(await gatewayJson(requireGateway(), `/v1/instances/${urlId(id)}/telegram`, { method: "DELETE" })),
  },

  // Slack and Teams of a Claude Code instance, relayed by the runtime gateway: a link code (and, for Slack,
  // the « Add to Slack » install link), how many accounts are linked, unplug.
  // Telegram relayed for a member of a team instance (`telegram-relay`); the account is the caller's, named to the
  // gateway so it ties the link to that member.
  channelRelay: {
    link: async (id: string, channel: RelayChannel): Promise<RelayLink> => parseAgent37(await gatewayJson(requireGateway(), `/v1/instances/${urlId(id)}/${relayPath(channel)}/link`, await asUser({ method: "POST" }))),
    status: async (id: string, channel: RelayChannel): Promise<RelayStatus> => parseAgent37(await gatewayJson(requireGateway(), `/v1/instances/${urlId(id)}/${relayPath(channel)}`, await asUser({}))),
    unlink: async (id: string, channel: RelayChannel): Promise<{ ok: true }> => parseAgent37(await gatewayJson(requireGateway(), `/v1/instances/${urlId(id)}/${relayPath(channel)}`, await asUser({ method: "DELETE" }))),
  },

  // What finished routine runs came to (absent: still running or unreadable); `null` direct, with no gateway.
  routineOutcomes: async (id: string, ids: string[], profileQuery = ""): Promise<Record<string, RunOutcome> | null> => {
    if (!runtimeGateway()) return null;
    const q = `${profileQuery ? `${profileQuery}&` : "?"}ids=${ids.map(encodeURIComponent).join(",")}`;
    return (await instanceCall<{ outcomes: Record<string, RunOutcome> }>(id, `/v1/routine-outcomes${q}`)).outcomes ?? {};
  },

  // A team member's screen: the tabs of their own experts, through the gateway (which reads their screen token).
  screen: async (id: string): Promise<{ ws: string; kind: "cast" }> =>
    parseAgent37(await gatewayJson(requireGateway(), `/v1/instances/${urlId(id)}/screen`, await asUser({ method: "POST" }))),

  // What the instance's runtime offers (the gateway's /capabilities); `null` direct, where every
  // instance is Hermes and offers everything.
  capabilities: async (id: string): Promise<RuntimeCapabilities | null> => {
    const gw = runtimeGateway();
    if (!gw) return null;
    return parseAgent37<RuntimeCapabilities>(await gatewayJson(gw, `/v1/instances/${urlId(id)}/capabilities`, await asUser({})));
  },
};
