// admin: sees and manages every agent of the workspace, invites people.
// member: creates and uses their own agent only (one per user).
export type Role = "admin" | "member";

export interface Workspace {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

export interface WorkspaceWithRole extends Workspace {
  role: Role;
  /** The company's main logo (back office `me.workspace.logoUrl`), shown at the top of the menu. */
  logo_url?: string | null;
  /** `entreprise`: the company chat only (an agent on the company's instance): no Experts, no integrations. */
  access?: "instance" | "entreprise" | "equipe";
  /** The company's main color (back office `me.workspace.brandColor`, #rrggbb), when it has one. */
  brand_color?: string | null;
  /** Salons open for the company (back office `/app/me`); absent when an older back office does not say. */
  salons?: boolean;
}

export interface WorkspaceMember {
  user_id: string;
  email: string;
  role: Role;
  /** When they joined; null when the source does not say. */
  created_at: string | null;
  // Known only when the back office lists the members.
  name?: string | null;
  status?: string | null;
  instance_name?: string | null;
  /** Back-office member id; `entreprise` members can be removed by an admin when `removable`. */
  id?: string;
  access?: "instance" | "entreprise" | "equipe";
  removable?: boolean;
}

/** Seats when the back office lists the members: subscription users and enterprise chat. */
export interface MemberRoom {
  quota: { used: number; allowed: number | null };
  seats: { used: number; cap: number } | null;
  enterpriseOpen: boolean;
  /** Domains an admin may invite (« mstudio.vc ») : the back office's list when it serves one, else the admin's own. */
  allowedDomains?: string[];
}

export interface Invitation {
  token: string;
  workspace_id: string;
  role: Role;
  created_at: string;
  expires_at: string;
}

/** Un Expert : un profil Hermes installé sur une instance de l'organisation. */
export interface Expert {
  profileId: string;
  displayName: string;
  /** L'instance qui porte ce profil — plusieurs Experts peuvent partager la même. */
  agentId: string;
  agentName: string | null;
  /** État de la passerelle du profil : « running » quand il peut répondre. */
  gateway: string | null;
  /** Distribution installée, par exemple `djeneba@7.0.0`. */
  distribution: string | null;

  // Enrichissement par le catalogue du back-office (lib/catalogue.ts). Absent tant que le
  // catalogue ne connaît pas cet expert ou n'est pas configuré : l'interface s'en passe.
  /** Clé de l'expert dans le catalogue (la partie du profil après « __ »). */
  catalogueKey?: string | null;
  /** Métier de l'Expert — « Chief of Staff », « Marketing et contenu »… */
  role?: string | null;
  /** Titre court, pour les listes étroites. */
  title?: string | null;
  tagline?: string | null;
  /** Trois demandes pour démarrer, sous la barre de message d'une discussion vide (catalogue, `suggestions`). */
  suggestions?: string[];
  /** Portrait de l'Expert. */
  photoUrl?: string | null;
  /** Son dossier dans le drive (~/Livrables/<dossier>), quand le catalogue le connaît. */
  driveFolder?: string | null;
  /** Le cycle souscrit qui l'a apporté (« Marketing événementiel »), quand le back-office le dit. */
  cycle?: { key: string; label: string } | null;
  /** Arrivée de l'Expert sur l'instance (« Embauché le »), ISO 8601, quand le back-office la dit. */
  since?: string | null;
}

/** Un expert tel que le back-office le présente : textes et médias, jamais de réglage d'agent. */
export interface CatalogueExpert {
  key: string;
  name: string;
  role: string | null;
  title: string | null;
  tagline: string | null;
  description: string | null;
  pronoun: "elle" | "il" | null;
  category: { key: string; label: string } | null;
  avatarUrl: string | null;
  /** Portrait en pied. */
  portraitUrl: string | null;
  /** Short looping video for the cards, when the catalogue lists one. */
  videoUrl: string | null;
  /** Dossier de l'expert dans le drive (~/Livrables/<dossier>). */
  driveFolder: string | null;
  /** Messages qu'on peut lui envoyer pour démarrer. */
  suggestions: string[];
}

/**
 * An expert's job sheet, as the site's Experts pages word it, served by the back office's catalogue
 * (`sheet` on /api/v1/public/experts/{key}); null while the expert's pack has none.
 */
export interface ExpertSheet {
  /** « Expert IA commercial », « Experte IA marketing ». */
  label: string | null;
  pronoun: "il" | "elle" | null;
  tagline: string | null;
  intro: string | null;
  mission: string | null;
  inAction: string | null;
  daily: string[];
  skills: { name: string; summary: string | null }[];
  deliverables: { label: string; summary: string | null }[];
  templates: string[];
  routines: { label: string; when: string | null }[];
  approval: string[];
  needs: string[];
}

export interface CatalogueExpertDetail extends CatalogueExpert {
  useCase: string | null;
  valueAdd: string | null;
  whyRelevant: string | null;
  salesDescription: string | null;
  skills: { name: string; summary: string | null }[];
  competencies: string[];
  deliverables: { label: string; thumbnailUrl: string | null }[];
  video: { url: string | null; posterUrl: string | null };
  sheet: ExpertSheet | null;
}

/** Où un expert du catalogue est installé pour l'utilisateur courant. */
export interface InstalledExpert {
  agentId: string;
  agentName: string | null;
  profileId: string;
}

/** GET /api/catalogue : le catalogue, croisé avec ce qui est installé. */
export interface CatalogueResponse {
  /** Faux quand le back-office n'est pas configuré ou ne répond pas. */
  available: boolean;
  defaultExpertKey: string | null;
  categories: { key: string; label: string }[];
  experts: (CatalogueExpert & { installed: InstalledExpert[] })[];
}

export interface AgentRow {
  agent37_id: string;
  workspace_id: string;
  // The profiles installed on the instance, mirrored by the back office (absent on older rows).
  profiles?: string[] | null;
  // SHA-256 of the instance's token for the tool proxy; set = the instance runs on Yelema's Composio.
  apps_token_hash?: string | null;
  name: string | null;
  status: string | null;
  template: string | null;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  created_by: string | null;
  owner_user_id: string | null;
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
  // Null for images published by a cloud build; compare template_revision instead.
  image_ref: string | null;
  template_revision: number | null;
  resources: { cpu: number; memory: number; disk: number };
  // Older API versions reported the instance's ports; current ones return null —
  // any port is reachable at a preview URL, nothing is declared.
  ports: { port: number; default: boolean; url: string }[] | null;
  user: string | null;
  name: string | null;
  metadata: Record<string, unknown> | null;
  // The instance URL mirrored under the workspace's custom domains, oldest first ([] without one).
  domain_urls?: string[];
  paid_through: number | null;
  past_due: boolean;
  created: number | null;
}

export interface Template {
  name: string;
  scope: "system" | "workspace";
  // Absent for templates published by a cloud build, which carry image_digest instead.
  image_ref?: string;
  image_digest?: string;
  revision: number | null;
  default_port: number | null;
  agents: string[];
  description: string;
  created: number | null;
  updated: number | null;
}

export interface Budget {
  monthly_cap_micros: number;
  monthly_consumed_micros: number;
  monthly_remaining_micros: number;
  monthly_period: string;
  credit_remaining_micros: number;
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
  // Kept by the back office: e-mail and name read once at connection, the member's label, the tool's
  // default for the experts, and who added it (null: added elsewhere, e.g. by an expert in chat).
  email?: string | null;
  accountName?: string | null;
  label?: string | null;
  alias?: string | null;
  isDefault?: boolean;
  addedBy?: { email: string; name: string | null } | null;
}

export interface IntegrationConnectionsResult {
  connections: IntegrationConnection[];
}

export interface IntegrationConnectResult {
  toolkit: string;
  connectedAccountId: string;
  redirectUrl: string;
}

/** GET /api/workspaces/{id}/instances : une instance telle qu'un admin la lit, sans rien pour y entrer. */
export interface WorkspaceInstance {
  name: string | null;
  /** Le membre à qui elle appartient. */
  member_email: string | null;
  /** Qui l'a créée, quand c'est un membre de l'espace ; sinon Yelema. */
  created_by_email: string | null;
  created_at: string | null;
  // Known only when the back office lists the instances.
  state?: string | null;
  experts?: string[];
}

export interface MergedAgent extends AgentRow {
  // Email of the member the agent belongs to (owner_user_id, else created_by); null if unknown.
  owner_email: string | null;
  live_status: string | null;
  status_reason: Agent["status_reason"];
  past_due: boolean;
  ports: NonNullable<Agent["ports"]>;
  update_available: boolean;
  // The image the instance really runs: its template's name (without any "@pin") and the revision
  // installed. Null when the instance could not be read.
  image: { template: string; revision: number | null } | null;
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
export const FILES_ONLY_PROMPT = "Voici des fichiers en pièce jointe. Prenez-en connaissance.";

// One message in a conversation's history (GET /v1/sessions/{id}).
export interface ChatHistoryMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  /** Deliverables the turn of this reply wrote (home-relative, under Livrables/). */
  files?: string[];
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
  message_count?: number | null;
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
