export type Role = "admin";

export interface Workspace {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

export interface WorkspaceWithRole extends Workspace {
  role: Role;
}

export interface WorkspaceMember {
  user_id: string;
  email: string;
  role: Role;
  created_at: string;
}

export interface Invitation {
  token: string;
  workspace_id: string;
  role: Role;
  created_at: string;
  expires_at: string;
}

export interface AgentRow {
  agent37_id: string;
  workspace_id: string;
  name: string | null;
  status: string | null;
  template: string | null;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  created_by: string | null;
  created_at: string;
}

export interface Agent {
  id: string;
  status: string;
  status_reason: {
    code: string;
    message: string;
    operation: string;
    at: number;
  } | null;
  template: string;
  image_ref: string;
  resources: { cpu: number; memory: number; disk: number };
  ports: { port: number; default: boolean; url: string }[];
  user: string | null;
  name: string | null;
  metadata: Record<string, unknown> | null;
  paid_through: number | null;
  past_due: boolean;
  created: number | null;
}

export interface Template {
  name: string;
  scope: "system" | "workspace";
  image_ref: string;
  agents: string[];
  description: string;
  ports: { port: number; default: boolean }[];
  created: number | null;
  updated: number | null;
}

export interface Budget {
  monthly_cap_micros: number;
  monthly_consumed_micros: number;
  monthly_remaining_micros: number;
  monthly_period: string;
  topup_remaining_micros: number;
  updated_at: number | null;
}

export interface Usage {
  period: string;
  total_micros: number;
  by_integration: {
    llm: { cost_micros: number; calls: number; input_tokens: number; output_tokens: number };
    brave: { cost_micros: number; calls: number };
    composio: { cost_micros: number; calls: number };
  };
}

export interface IntegrationToolkit {
  slug: string;
  name: string;
  description: string | null;
  logo: string | null;
  enabled: boolean;
  isNoAuth: boolean;
  authSchemes: string[];
}

export interface IntegrationToolkitsResult {
  items: IntegrationToolkit[];
}

// Composio's connected-account shape, as returned by the v1 connections endpoint.
export interface IntegrationConnection {
  id: string;
  status: string;
  userId?: string | null;
  toolkitSlug?: string | null;
  toolkitName?: string | null;
  authConfigId?: string | null;
  authScheme?: string | null;
  isDisabled?: boolean;
  createdAt?: number | null;
  updatedAt?: number | null;
}

export interface IntegrationConnectionsResult {
  connections: IntegrationConnection[];
}

export interface IntegrationConnectResult {
  toolkit: string;
  connectedAccountId: string;
  redirectUrl: string;
}

export interface MergedAgent extends AgentRow {
  live_status: string | null;
  status_reason: Agent["status_reason"];
  past_due: boolean;
  ports: Agent["ports"];
  update_available: boolean;
}

// ---- Agent37 Agents API (data plane: per-instance web chat) ----

// One model the instance's agent can run (GET /v1/models -> data[]). Current Hermes builds report
// the provider slug as `owned_by` ("anthropic"); the older metered build used `provider`
// ("custom:agent37"). Read `owned_by ?? provider` so the switcher groups correctly on either.
export interface AgentModel {
  id: string;
  label: string;
  owned_by?: string;
  provider?: string;
  is_default?: boolean;
}

export interface ModelsResponse {
  default_model: string | null;
  default_provider: string | null;
  data: AgentModel[];
}

// The input the chat BFF substitutes for a files-only turn (the Agents API requires a non-empty
// `input`).
export const FILES_ONLY_PROMPT = "Please review the attached file(s).";

// One message in a conversation's history (GET /v1/sessions/{id}).
export interface ChatHistoryMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  created_at: number;
}

export interface SessionDetail {
  id: string;
  agent: string;
  /** The response currently running on the session, or null when idle. The harness persists a
   *  turn's messages at turn end, so while this is set the running turn is not in `history` yet —
   *  follow it via GET /v1/responses/{id}/stream. Null means the transcript is complete. */
  active_response_id: string | null;
  history: ChatHistoryMessage[];
}

// One conversation in the instance's session list (GET /v1/sessions -> data[]). Current Hermes
// builds carry a server-side `title` (settable via PATCH /v1/sessions/{id}) plus a `preview` of
// the first message and `last_active`/`started_at` timestamps. The rail label is resolved in the
// sessions route as `title || preview`; ordering is by `last_active`. There is no local sessions
// table — the Agents API is the source of truth.
export interface SessionSummary {
  id: string;
  title?: string | null;
  preview?: string | null;
  last_active?: number | null;
  started_at?: number | null;
}

export interface SessionListResponse {
  data: SessionSummary[];
}

// ---- Agent37 Agents API file browser (data plane: per-instance /v1/files) ----

// One entry in a directory listing, also returned by every write (PUT/PATCH/POST dir). The
// `path` is the resolved ABSOLUTE path and is the identity used by every other call. `modified`
// is mtime in EPOCH MILLISECONDS (Agent API convention); `size` is null for directories.
export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number | null;
  modified: number;
  hidden: boolean;
}

// GET /v1/files?path= — one directory level. `parentPath` is null at the filesystem root.
// `truncated` is true when the directory held more than the 1000-entry cap.
export interface FileListResponse {
  path: string;
  parentPath: string | null;
  entries: FileEntry[];
  truncated: boolean;
}
