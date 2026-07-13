import "server-only";
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

function instanceBaseUrl(id: string): string {
  return `https://${id}.${INSTANCE_DOMAIN}`;
}

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
      error?: { code?: string; message?: string };
    };
    const err = raw.error ?? raw;
    let message = err.message || res.statusText;
    if (augment402 && res.status === 402) {
      // Almost always an unfunded wallet at create/start time — point the operator at billing.
      message = `${message} (Agent37 payment required — fund your wallet under Cloud → Billing in the dashboard, then retry.)`;
    }
    throw new Agent37Error(res.status, err.code || "error", message);
  }

  return data as T;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
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
  const key = process.env.AGENT37_API_KEY;
  if (!key) {
    throw new Agent37Error(500, "config_error", "AGENT37_API_KEY is not set on the server");
  }
  const body = init?.body instanceof ReadableStream ? await new Response(init.body).arrayBuffer() : init?.body;
  return fetch(`${instanceBaseUrl(id)}${path}`, {
    ...init,
    body,
    headers: { "X-Agent37-Key": key, ...(init?.headers || {}) },
    cache: "no-store",
  });
}

// JSON helper against an instance's Agents API — same parse + Agent37Error semantics as `call`,
// without the 402 wallet hint (a data-plane 402 is budget exhaustion mid-chat, not wallet funding).
async function instanceCall<T>(id: string, path: string, init?: RequestInit): Promise<T> {
  const res = await instanceFetch(id, path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });

  return parseAgent37<T>(res);
}

export interface CreateAgentInput {
  template?: string;
  resources?: { cpu?: number; memory?: number; disk?: number };
  user?: string;
  name?: string;
  metadata?: Record<string, unknown>;
  budget?: { monthly_cap_micros?: number; topup_micros?: number };
}

export interface ResizeInput {
  cpu?: number;
  memory?: number;
  disk?: number;
}

export const agent37 = {
  listAgents: () => call<{ data: Agent[] }>("/instances"),
  getAgent: (id: string) => call<Agent>(`/instances/${id}`),
  createAgent: (body: CreateAgentInput) =>
    call<Agent>("/instances", { method: "POST", body: JSON.stringify(body) }),
  deleteAgent: (id: string) =>
    call<{ id: string; deleted: boolean }>(`/instances/${id}`, { method: "DELETE" }),

  start: (id: string) => call<{ id: string; status: string }>(`/instances/${id}/start`, { method: "POST" }),
  stop: (id: string) => call<{ id: string; status: string }>(`/instances/${id}/stop`, { method: "POST" }),
  restart: (id: string) => call<{ id: string; status: string }>(`/instances/${id}/restart`, { method: "POST" }),
  update: (id: string) =>
    call<{ id: string; status: string; image_ref: string }>(`/instances/${id}/update`, { method: "POST" }),
  resize: (id: string, body: ResizeInput) =>
    call<{ id: string; status: string; resources: { cpu: number; memory: number; disk: number } }>(
      `/instances/${id}/resize`,
      { method: "POST", body: JSON.stringify(body) }
    ),

  signedUrl: (id: string, port: number, ttlSeconds?: number) =>
    call<{ url: string; port: number; expires_at: number }>(`/instances/${id}/signed-url`, {
      method: "POST",
      body: JSON.stringify({ port, ...(ttlSeconds ? { ttl_seconds: ttlSeconds } : {}) }),
    }),

  getBudget: (id: string) => call<Budget>(`/instances/${id}/budget`),
  setBudget: (id: string, body: { monthly_cap_micros: number }) =>
    call<Budget>(`/instances/${id}/budget`, { method: "PATCH", body: JSON.stringify(body) }),
  getUsage: (id: string, month?: string) =>
    call<Usage>(`/instances/${id}/usage${month ? `?month=${encodeURIComponent(month)}` : ""}`),

  listTemplates: () => call<{ data: Template[] }>("/templates"),

  // ---- Per-instance Agents API (data plane: web chat) — served on the instance host, see
  // instanceFetch. The streaming surfaces (POST /v1/responses SSE, GET/PUT /v1/files/content,
  // GET /v1/files/archive) go through instanceFetch directly from their routes. ----
  listModels: (id: string) => instanceCall<ModelsResponse>(id, "/v1/models"),
  // The thread rail: every session on the instance. Items carry `title`, a `preview` of the first
  // message, and timestamps — the sessions route turns these into the rail's label + ordering.
  listSessions: (id: string) => instanceCall<SessionListResponse>(id, "/v1/sessions"),
  getSession: (id: string, sessionId: string) =>
    instanceCall<SessionDetail>(id, `/v1/sessions/${encodeURIComponent(sessionId)}`),
  deleteSession: (id: string, sessionId: string) =>
    instanceCall<{ id: string; deleted: boolean }>(
      id,
      `/v1/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" }
    ),
  // Set a session's title. Supported on newer Hermes builds; older ones answer 404/405 (the
  // PATCH route maps that to a friendly "not supported yet" so the rail degrades gracefully).
  renameSession: (id: string, sessionId: string, title: string) =>
    instanceCall<{ id: string; agent: string; renamed: boolean }>(
      id,
      `/v1/sessions/${encodeURIComponent(sessionId)}`,
      { method: "PATCH", body: JSON.stringify({ title }) }
    ),
  cancelResponse: (id: string, responseId: string) =>
    instanceCall<{ id: string; status: string }>(
      id,
      `/v1/responses/${encodeURIComponent(responseId)}/cancel`,
      { method: "POST" }
    ),

  // ---- Per-instance file browser (Agents API /v1/files) — JSON surfaces only. The byte surfaces
  // (GET/PUT /v1/files/content, GET /v1/files/archive) stream and so go through instanceFetch. ----
  // List one directory level. Omit `path` for the agent's default workspace dir. Upstream typed
  // errors (e.g. not_a_directory) ride back as Agent37Error and keep their code/status.
  listFiles: (id: string, path?: string) =>
    instanceCall<FileListResponse>(id, `/v1/files${path ? `?path=${encodeURIComponent(path)}` : ""}`),
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
    return call<IntegrationToolkitsResult>(`/instances/${id}/integrations/toolkits${q}`);
  },
  connectIntegration: (id: string, body: { toolkit: string }) =>
    call<IntegrationConnectResult>(`/instances/${id}/integrations/connect`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listIntegrationConnections: (id: string) =>
    call<IntegrationConnectionsResult>(`/instances/${id}/integrations/connections`),
  disconnectIntegration: (id: string, connectedAccountId: string) =>
    call<{ id: string; deleted: boolean }>(
      `/instances/${id}/integrations/connections/${connectedAccountId}`,
      { method: "DELETE" }
    ),
};
