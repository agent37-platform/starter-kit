import type { AccountDraft, LayoutDraft, LlmAccount } from "@/lib/llm-accounts";
import type { ModelGroup } from "@/lib/model-options";
import "server-only";
import type { CompanyProfile } from "@/lib/company";
import type { ComposioCall } from "@/lib/composio-usage";
import { voiceKeyPath, type VoiceKeysOverview } from "@/lib/voice-keys";
import { isServerId, mcpScopePath, mcpServerPath, type McpOauthQuery, type McpOauthServer, type McpOverview, type McpToolsOverview, type McpToolsReport, type McpServerDraft, type McpWritten } from "@/lib/mcp-servers";
import type { UnipileAccount, UnipileDraft, UnipileStatus } from "@/lib/unipile";
import { vaultPath, type VaultDraft, type VaultEntry, type VaultItem, type VaultList, type VaultOverview, type VaultRef, type VaultScope } from "@/lib/vault";
import { scopePath, type LlmModelChoice, type LlmOverview, type LlmWritten, type SettingScope } from "@/lib/llm";
import { mailPath, type MailDetail, type MailDraft, type MailInbox, type MailRights, type MailRightsPatch, type MailSummary } from "@/lib/mail";
import { isPublicId, type MemoryList, type MemoryNote, type MemoryPatch, type OrgAssignmentDraft, type OrgChart, type OrgGrantDraft, type OrgMember, type OrgRole } from "@/lib/memory";
import { backofficeUrl, resolverToken } from "@/lib/runtime-config";
import { SIGNALING_METHOD, type CallRecord, type SignalingStep, type VoiceOption } from "@/lib/voice";
import { pinnedWorkspaceId } from "@/lib/tenant";
import type { BuzzOverview } from "@/lib/buzz";
import type { ClaudeAuth, ClaudeAuthStatus, ClaudeLogin, ClaudeUsage } from "@/lib/claude-code-auth";

// The Yelema back office's API for this app (`/api/v1/app/*`, guide: yelema-platform
// docs/specs/client-api-v1/app.md). It signs users in and says what they may see: their account,
// their workspace, THEIR instance and its installed experts, and for admins the workspace's members
// and instances. It applies its own rules on every call (suspended account, member or client).
//
// Every call names the workspace the request is for (X-Workspace-Id): the deployment's own, or the
// one its host belongs to (src/lib/tenant.ts). The user's session rides as a Bearer token. This
// module is the only one that speaks that API.

// A cold compilation in development can take longer than a production answer.
const TIMEOUT_MS = process.env.NODE_ENV === "development" ? 60_000 : 15_000;
// Sending an e-mail with attachments goes on to the provider before it answers.
const MAIL_SEND_TIMEOUT_MS = 90_000;
// Saving a model key waits for the provider to say whether it accepts it.
const SETTING_WRITE_TIMEOUT_MS = 30_000;
const VAULT_BATCH_TIMEOUT_MS = 130_000;
// Le code de connexion attend la réponse de Claude sur l'instance (jusqu'à ~25 s).
const CLAUDE_LOGIN_TIMEOUT_MS = 60_000;
const memberQuery = (member: string | null): string => (member ? `?member=${encodeURIComponent(member)}` : "");
const withQuery = (query: string, name: string, value: string | null): string => (value ? `${query}${query ? "&" : "?"}${name}=${encodeURIComponent(value)}` : query);
// An OAuth start or return waits on Hermes inside the instance (up to 45 s, then 60 s and a gateway restart).
const MCP_OAUTH_TIMEOUT_MS = 115_000;
// A portrait is drawn by the image model, which takes up to a minute.
const AVATAR_GENERATE_TIMEOUT_MS = 120_000;
// A reasoned answer of the company memory runs a model on the provider's side.
const MEMORY_ASK_TIMEOUT_MS = 75_000;
// A dictation is transcribed in about the time it was spoken (4 minutes at most).
const DICTATION_TIMEOUT_MS = 95_000;

export class BackofficeError extends Error {
  status: number;
  code: string;
  /** Seconds to wait before trying again (rate limit), when the back office says so. */
  retryAfter: number | null;
  /** What a refusal carries besides its code: the models to propose in place of an unknown one. */
  suggestions: unknown[];
  constructor(status: number, code: string, message: string, retryAfter: number | null = null, suggestions: unknown[] = []) {
    super(message);
    this.name = "BackofficeError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.suggestions = suggestions;
  }
}

export interface BoSession {
  accessToken: string;
  refreshToken: string;
  /** When the access token expires, in epoch seconds. */
  expiresAt: number;
}

/** `voices`: per expert key or `*`, per language, a voice key or `null` back to the default. */
export type MePatch = { firstName?: string; lastName?: string; jobTitle?: string; voices?: Record<string, Partial<Record<"fr" | "en", string | null>>> };

export interface BoMe {
  /** `id` is the account's stable id: the user's connected apps (Composio) hang off it. */
  /** `name` is « Prénom Nom », computed by the back office from the two. */
  /** `avatarUrl`: the member's own photo, once the back office keeps one (`PUT /app/me/avatar`). */
  user: { id: string; email: string; firstName: string | null; lastName: string | null; name: string | null; jobTitle: string | null; role: "admin" | "member"; avatarUrl?: string | null; /** Call voice per expert (`*` = all) and language, shared with the mobile app. */ voices?: Record<string, Partial<Record<"fr" | "en", string>>> };
  workspace: { id: string; name: string; logoUrl: string | null; brandColor?: string | null };
  instance: { id: string } | null;
  /** `entreprise`: company chat only — no Experts, no instance of one's own. `equipe`: Experts on a team instance. */
  access?: "instance" | "entreprise" | "equipe";
}

export interface BoInstanceView {
  name: string;
  /** State at Agent37 (`running`, `sleeping`…); `unknown` when it could not be read. */
  state: string;
  createdAt: string | null;
  image: { template: string | null; revision: number | null };
  /** False while a profile is being installed. */
  ready: boolean;
  /** Which Composio the instance's experts use. */
  tools: "yelema" | "agent37";
  /** Set when the member has no instance of their own: their agent (enterprise chat) or seat (team instance). */
  seat?: string;
  /**
   * `profile` is the name to send to the instance; `key` joins the public catalogue. `displayName`
   * and `avatarUrl` are what the member chose for it, null when they kept the catalogue's. `cycle`
   * is the cycle the company subscribed that brought it, when it came with one (back office, to come).
   */
  experts: {
    profile: string;
    key: string;
    version: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
    cycle?: { key: string; label: string } | null;
  }[];
  /** Where a channel that receives by webhook is reached: the address to give Microsoft for Teams. */
  channels?: { teams?: { endpoint: string | null } };
  /** Team instance only: the team, its members (the caller first) and the expert keys open to each. */
  team?: TeamRoster;
}

/** A file an expert of a salon put in its `Salons/<id>/` folder; `url` is signed and short-lived. */
export interface SalonDeliverable { id: string; expertId: string; title: string; kind: string; updatedAt: string; url: string | null; folder: string; auteur: string }

export interface TeamRoster { name: string; members: { name: string | null; email: string; you: boolean; experts: string[] }[] }

/** Where the expert's own name stands on the instance: written in its SOUL.md, or on its way. */
export type ExpertIdentityState = "pending" | "applied" | "failed";

/** An installed expert as its member made it: their name and picture over the catalogue's. */
export interface ExpertLook {
  key: string;
  profile: string;
  defaultName: string;
  displayName: string | null;
  role: string | null;
  avatarUrl: string | null;
  defaultAvatarUrl: string | null;
  identity: { state: ExpertIdentityState | null };
}

/** A generated portrait, not yet the expert's: applied with `setExpertAvatar({ draftId })`. */
export interface ExpertAvatarDraft {
  draftId: string;
  url: string;
}

export type DashboardShareMode = "team" | "people" | "link";

/** A dashboard's share as the back office keeps it; `number` is sealed into the link and never sent to a browser. */
/** `/app/integrations/connections` : what the back office keeps about one connected account. */
export interface BoConnectorAccount {
  id: string;
  toolkit: string;
  email: string | null;
  name: string | null;
  label: string | null;
  isDefault: boolean;
  addedBy: { email: string; name: string | null } | null;
  createdAt: string | null;
}

export interface BoDashboardShareView {
  share: { id: string; number: string; mode: DashboardShareMode; people: string[]; updatedAt: string | null } | null;
  candidates: { email: string; name: string | null }[];
}

export type BoInstance = BoInstanceView & { id: string };

/** Where the installation of a member's team stands. */
export type BoInstallation = "running" | "ready" | "failed";

/** What the back office says of the signed-in user's instance. */
export interface BoInstanceReading {
  /** Null while the instance itself is still being created. */
  instance: BoInstance | null;
  /**
   * `running`: the instance is being created, or an expert is queued or being installed.
   * `failed`: nothing is under way any more, and the instance or at least one expert failed.
   */
  installation: BoInstallation;
  /** Catalogue keys of the experts whose installation failed. */
  failedExperts: string[];
}

export interface BoMember {
  id: string;
  name: string | null;
  email: string;
  role: "admin" | "member";
  status: string;
  instance: { name: string; createdAt: string | null } | null;
  /** `entreprise` : membre du chat d'entreprise, sans instance à lui. */
  access: "instance" | "entreprise";
  /** Un admin peut le retirer depuis l'app (membre `entreprise`, pas lui-même). */
  removable: boolean;
}

/** Places : utilisateurs de l'abonnement (`allowed` nul = sans plafond), membres du chat d'entreprise. */
export interface BoMemberRoom {
  quota: { used: number; allowed: number | null };
  seats: { used: number; cap: number } | null;
  enterpriseOpen: boolean;
}

export type BoOpenedSession = { session: BoSession } & BoMe;

/** The org chart as the back office sends it: an expert's `name` is the member's, or null. */
export type BackofficeOrgChart = Omit<OrgChart, "members"> & {
  members: (Omit<OrgMember, "experts"> & { experts?: { profile: string; key: string; name: string | null }[] })[];
};

/** One invoice of the workspace. Amounts are in major units (XOF has no decimals); dates are ISO. */
export interface BoInvoice {
  /** Public id, the one the PDF and payment-link routes take. */
  id: string;
  reference: string;
  /** The month invoiced, "YYYY-MM". */
  period: string;
  status: "issued" | "overdue" | "paid";
  amountTTC: number;
  currency: string;
  issuedAt: string | null;
  dueDate: string | null;
  /** True while the invoice can be paid online (issued, overdue). */
  payable: boolean;
}

export interface BoBilling {
  plan: { key: string; name: string } | null;
  status: "active" | "suspended" | null;
  nextDueDate: string | null;
  /** The subscription's monthly amount. */
  amount: number | null;
  currency: string;
  /** The oldest invoice still to pay. */
  openInvoice: BoInvoice | null;
}

// A catalogue key or an invoice id goes into the back office's URL: only its plain form is let
// through.
const EXPERT_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function expertKey(key: string): string {
  if (!EXPERT_KEY.test(key)) throw new BackofficeError(404, "not_found", "Expert introuvable.");
  return key;
}
const INVOICE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function invoicePath(id: string, rest: string): string {
  if (!INVOICE_ID.test(id)) throw new BackofficeError(404, "not_found", "Facture introuvable.");
  return `/app/billing/invoices/${id}${rest}`;
}

// The one way out to the back office: its address, the request's workspace, a deadline, and an
// outage read as one (503, a sentence for the member).
async function send(path: string, init: { method?: string; workspace?: string; timeoutMs?: number; headers: Record<string, string>; body?: BodyInit }): Promise<Response> {
  const base = backofficeUrl();
  const workspace = init.workspace ?? (await pinnedWorkspaceId());
  if (!base || !workspace) throw new BackofficeError(500, "config_error", "BACKOFFICE_URL and a workspace are required");
  try {
    return await fetch(`${base}/api/v1${path}`, {
      method: init.method ?? "GET",
      headers: { "X-Workspace-Id": workspace, ...init.headers },
      body: init.body,
      cache: "no-store",
      signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (e) {
    console.error(`[backoffice] ${path} unreachable:`, e instanceof Error ? e.message : e);
    throw new BackofficeError(503, "unavailable", "Le service est momentanément indisponible. Réessayez dans un instant.");
  }
}

// `workspace` is given by the proxy, which runs before a request has a scope to read it from.
// `form` sends a multipart body instead of JSON (a document for the company memory).
async function call<T>(path: string, init: { method?: string; token?: string | null; body?: unknown; form?: FormData; workspace?: string; timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await send(path, {
    method: init.method ?? "GET",
    workspace: init.workspace,
    timeoutMs: init.timeoutMs,
    headers: {
      Accept: "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
    body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // A gateway page instead of JSON: treated as an outage below.
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; suggestions?: unknown } } | null)?.error;
    const retry = Number(res.headers.get("retry-after"));
    if (!err) console.error(`[backoffice] ${path}: ${res.status}`, text.slice(0, 300));
    throw new BackofficeError(
      res.status,
      err?.code ?? (res.status >= 500 ? "unavailable" : "error"),
      err?.message ?? "Le service est momentanément indisponible. Réessayez dans un instant.",
      Number.isFinite(retry) && retry > 0 ? retry : null,
      Array.isArray(err?.suggestions) ? err.suggestions : []
    );
  }
  return data as T;
}

/** The tool executions of one request through the Composio proxy, as the back office records them. */
export interface ComposioCallsDeclaration {
  /** Drawn once per proxied request: the back office ignores one it has already seen. */
  requestId: string;
  /** When Composio answered. */
  occurredAt: string;
  httpStatus: number;
  calls: ComposioCall[];
}

/** Tool executions and what they cost. Amounts are in thousandths of a CFA franc. */
export interface BoUsageCount {
  executions: number;
  amountMilliXof: number;
}

/** What the workspace's experts spent on tools over a period (days are UTC, both ends included). */
export interface BoComposioUsage extends BoUsageCount {
  from: string;
  to: string;
  /** One point per day of the period, at zero when nothing was declared. */
  byDay: ({ day: string } & BoUsageCount)[];
  /** `toolkit` is null when the application is unknown. */
  byToolkit: ({ toolkit: string | null } & BoUsageCount)[];
  /** `email` is null for calls of an instance without a member. */
  byMember: ({ email: string | null; name: string | null } & BoUsageCount)[];
}

export interface BoComposioCall {
  occurredAt: string;
  email: string | null;
  name: string | null;
  toolkit: string | null;
  tool: string;
  /** `meta`: a discovery tool, listed at price 0 and left out of `executions`. */
  via: "direct" | "multi_execute" | "meta";
  httpStatus: number;
  priceMilliXof: number;
}

/** A period (`YYYY-MM-DD`, 92 days at most) and optionally one member, by e-mail. */
export interface BoUsageFilter {
  from?: string;
  to?: string;
  member?: string;
}

// A path of the experts' e-mail, or a 404: an expert key or a message id that is not in its plain
// form never reaches the back office's URL.
function mailRoute(expert: string, messageId?: string, attachmentId?: string): string {
  const path = mailPath(expert, messageId, attachmentId);
  if (!path) throw new BackofficeError(404, "not_found", "Ce message est introuvable.");
  return path;
}

function dashboardSharePath(profile: string): string {
  const p = profile.toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(p)) throw new BackofficeError(404, "not_found", "Tableau de bord introuvable.");
  return `/app/dashboards/shares/${p}`;
}

function connectorAccountPath(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new BackofficeError(404, "not_found", "Compte inconnu.");
  return `/app/integrations/connections/${id}`;
}

function usageQuery(filter: BoUsageFilter, page?: number): string {
  const params = new URLSearchParams();
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  if (filter.member) params.set("member", filter.member);
  if (page) params.set("page", String(page));
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** `/app/me/preferences` : épinglé, archivé et notifications du membre, gardés par le back-office. */
export type MemberPrefs = { chatMarks: { pinned: string[]; archived: string[] }; notify: Record<string, boolean> };

export const backoffice = {
  login: (email: string, password: string) =>
    call<BoOpenedSession>("/app/auth/login", { method: "POST", body: { email, password } }),
  refresh: (refreshToken: string, workspace?: string) =>
    call<BoOpenedSession>("/app/auth/refresh", { method: "POST", body: { refreshToken }, workspace }),
  // First access or a new password: consumes the link the back office sent.
  accept: (tokenHash: string, type: string, password: string) =>
    call<BoOpenedSession>("/app/auth/accept", { method: "POST", body: { tokenHash, type, password } }),
  // A new invitation from an expired one: the back office finds the member from the old link and sends
  // a fresh one (a route asked of the back office on 27/10/26). Always answers ok.
  resendInvite: (tokenHash: string) => call<{ ok: true }>("/app/auth/invite/resend", { method: "POST", body: { tokenHash } }),
  // Always answers ok, whether or not the account exists.
  forgot: (email: string) => call<{ ok: true }>("/app/auth/forgot", { method: "POST", body: { email } }),
  logout: (token: string) => call<{ ok: true }>("/app/auth/logout", { method: "POST", token }),

  // Whether Yelema's team is shipping an update right now (switched on before a push, off after).
  // Public and per workspace; a short timeout: it is asked every minute by every open page.
  platformStatus: () => call<{ maintenance?: boolean }>("/app/platform-status", { timeoutMs: 4_000 }),
  me: (token: string) => call<BoMe>("/app/me", { token }),
  updateMe: (token: string, patch: MePatch) => call<BoMe>("/app/me", { method: "PATCH", token, body: patch }),
  // The member's own photo (multipart, field `file`): the back office checks the type and the size,
  // keeps it and answers the profile with its `avatarUrl`. `DELETE` goes back to the initial.
  setMyAvatar: (token: string, form: FormData) => call<BoMe>("/app/me/avatar", { method: "PUT", token, form, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),
  removeMyAvatar: (token: string) => call<BoMe>("/app/me/avatar", { method: "DELETE", token }),
  preferences: (token: string) => call<MemberPrefs>("/app/me/preferences", { token }),
  setPreferences: (token: string, body: Partial<MemberPrefs>) => call<MemberPrefs>("/app/me/preferences", { method: "PUT", token, body }),
  instance: async (token: string): Promise<BoInstanceReading> => {
    const d = await call<{ instance: BoInstance | null; installation?: string; failedExperts?: unknown }>("/app/instance", { token });
    const known = d.installation === "running" || d.installation === "ready" || d.installation === "failed";
    return {
      instance: d.instance,
      // A back office older than this field only says `ready`: not ready is "running" then.
      installation: known ? (d.installation as BoInstallation) : d.instance?.ready === false ? "running" : "ready",
      failedExperts: Array.isArray(d.failedExperts) ? d.failedExperts.filter((k): k is string => typeof k === "string") : [],
    };
  },
  // A member asks for an expert they do not have. The back office records it and tells Yelema's
  // team; nothing is installed or charged. Asking twice is the same as asking once.
  requestExpert: (token: string, key: string) => {
    if (!EXPERT_KEY.test(key)) throw new BackofficeError(404, "not_found", "Expert introuvable.");
    return call<{ ok: true }>(`/app/experts/${key}/request`, { method: "POST", token });
  },
  // The owner's share of an expert's dashboard. The back office checks the expert is on the caller's
  // instance and keeps who may read it; the expert's own files never decide that.
  dashboardShare: (token: string, profile: string) => call<BoDashboardShareView>(dashboardSharePath(profile), { token }),
  saveDashboardShare: (token: string, profile: string, body: { mode: DashboardShareMode; people?: string[]; regenerate?: boolean }) =>
    call<BoDashboardShareView>(dashboardSharePath(profile), { method: "PUT", token, body }),
  stopDashboardShare: (token: string, profile: string) => call<BoDashboardShareView>(dashboardSharePath(profile), { method: "DELETE", token }),
  // On every opening of a shared link, in the app's name (its resolver secret), with the reader's
  // session when there is one: the instance and profile to read, or 401 login_required / 403 / 404.
  dashboardAccess: (workspace: string, share: string, number: string, session: string | null) => {
    const secret = resolverToken();
    if (!secret) throw new BackofficeError(404, "not_found", "Tableau de bord introuvable.");
    const qs = new URLSearchParams({ share, n: number });
    return call<{ instance: string; profile: string; mode: DashboardShareMode }>(`/app/dashboards/access?${qs.toString()}`, {
      token: secret,
      workspace,
      timeoutMs: 10_000,
      headers: session ? { "X-App-Session": session } : {},
    });
  },
  // A member's own name and picture for an expert installed on their instance. The back office checks
  // the expert is theirs, keeps the choice, and writes the name in the expert's SOUL.md itself.
  expertLook: (token: string, key: string) => call<ExpertLook>(`/app/experts/${expertKey(key)}`, { token }),
  renameExpert: (token: string, key: string, displayName: string | null) =>
    call<ExpertLook>(`/app/experts/${expertKey(key)}`, { method: "PATCH", token, body: { displayName }, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),
  // `form` carries either the picture (`file`) or a generated portrait to keep (`draftId`).
  setExpertAvatar: (token: string, key: string, form: FormData) =>
    call<ExpertLook>(`/app/experts/${expertKey(key)}/avatar`, { method: "PUT", token, form, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),
  resetExpertAvatar: (token: string, key: string) => call<ExpertLook>(`/app/experts/${expertKey(key)}/avatar`, { method: "DELETE", token }),
  // The four choices and an optional reference face; the prompt is the back office's.
  generateExpertAvatar: (token: string, key: string, form: FormData) =>
    call<ExpertAvatarDraft>(`/app/experts/${expertKey(key)}/avatar/generate`, { method: "POST", token, form, timeoutMs: AVATAR_GENERATE_TIMEOUT_MS }),
  // The one call made in an instance's name rather than a user's: the Bearer is the instance's own
  // tool-proxy token, which the back office knows by its hash, and the workspace is the one of the
  // instance's row, not of the address that was called. The back office prices and stores each
  // execution; the app keeps nothing.
  reportComposioCalls: (instanceToken: string, workspace: string, declaration: ComposioCallsDeclaration) =>
    call<null>("/app/composio-calls", { method: "POST", token: instanceToken, workspace, body: declaration }),
  // Admins only, and without instance ids: lists to read, not ways in.
  instances: async (token: string) =>
    (await call<{ items: { member: { name: string | null; email: string }; instance: BoInstanceView }[] }>("/app/instances", { token })).items,
  members: (token: string) => call<{ items: BoMember[] } & BoMemberRoom>("/app/members", { token }),
  inviteMember: (token: string, body: { email: string; firstName: string; lastName: string }) =>
    call<{ ok: true; warning: string | null }>("/app/members/invite", { method: "POST", token, body }),
  removeMember: (token: string, id: string) => call<{ ok: true }>(`/app/members/${encodeURIComponent(id)}`, { method: "DELETE", token }),

  // Billing, for the workspace's admins (a member is refused, 403). The app reads and hands out the
  // back office's own payment link; it never creates a payment.
  billing: (token: string) => call<BoBilling>("/app/billing", { token }),
  // Newest first, never a draft.
  invoices: async (token: string) => (await call<{ items: BoInvoice[] }>("/app/billing/invoices", { token })).items,
  // The page where the invoice is paid, the same as in the back office's e-mail.
  paymentLink: (token: string, invoiceId: string) =>
    call<{ url: string }>(invoicePath(invoiceId, "/payment-link"), { method: "POST", token }),
  // What the experts' tools cost, for the workspace's admins (403 for a member; 404 for an e-mail
  // that is no member's). Calls come newest first, 100 a page.
  composioUsage: (token: string, filter: BoUsageFilter) =>
    call<BoComposioUsage>(`/app/composio-usage${usageQuery(filter)}`, { token }),
  composioUsageCalls: (token: string, filter: BoUsageFilter, page: number) =>
    call<{ page: number; hasMore: boolean; items: BoComposioCall[] }>(`/app/composio-usage/calls${usageQuery(filter, page)}`, { token }),
  // The invoice's PDF, as a stream for the route to pipe.
  invoicePdf: (token: string, invoiceId: string) => stream(invoicePath(invoiceId, "/pdf"), token),

  // The experts' e-mail. One inbox per expert for the whole workspace; the back office holds the
  // provider's key and decides on every call who may read and who may send. A refusal to send is a
  // 403 whose sentence is shown as it is; 404 everywhere when the feature is off.
  // Voice calls: the back office answers with Aethex's own bodies, which the browser's SDK reads.
  voiceCalls: async (token: string, expert: string | null) =>
    (await call<{ items: CallRecord[] }>(`/app/voice/calls${expert ? `?expert=${encodeURIComponent(expert)}` : ""}`, { token })).items,
  voiceVoices: async (token: string) => (await call<{ items: VoiceOption[] }>("/app/voice/voices", { token })).items,
  // A dictation of the chat (WAV/FLAC/Ogg), transcribed by the back office's speech service.
  voiceTranscribe: (token: string, form: FormData) => call<{ text: string }>("/app/voice/transcribe", { method: "POST", token, form, timeoutMs: DICTATION_TIMEOUT_MS }),
  // A voice note an instance received (Telegram…), relayed with its token by /api/stt.
  voiceNoteTranscribe: (instanceToken: string, workspace: string, form: FormData) =>
    call<{ text: string }>("/app/voice/instance-transcribe", { method: "POST", token: instanceToken, workspace, form, timeoutMs: DICTATION_TIMEOUT_MS }),
  voiceStart: (token: string, headers: Record<string, string>, body: unknown) =>
    call<Record<string, unknown>>("/app/voice/calls", { method: "POST", token, body, headers }),
  voiceSignal: (token: string, conversationId: string, step: SignalingStep, body: unknown) =>
    call<Record<string, unknown>>(`/app/voice/calls/${conversationId}/${step}`, { method: SIGNALING_METHOD[step], token, body }),
  voiceThinkLonger: (token: string, conversationId: string, on: boolean) =>
    call<{ thinkLonger: boolean }>(`/app/voice/calls/${conversationId}/think-longer`, { method: "POST", token, body: { on } }),
  mailInboxes: async (token: string) => (await call<{ items: MailInbox[] }>("/app/mail/inboxes", { token })).items,
  // Newest first, 25 a page; `page` is the previous answer's `nextPageToken`.
  mailMessages: (token: string, expert: string, page?: string) =>
    call<{ items: MailSummary[]; nextPageToken: string | null }>(`${mailRoute(expert)}${page ? `?page=${encodeURIComponent(page)}` : ""}`, { token }),
  mailMessage: (token: string, expert: string, messageId: string) => call<MailDetail>(mailRoute(expert, messageId), { token }),
  mailSend: (token: string, expert: string, draft: MailDraft) =>
    call<{ messageId: string; threadId: string; from: string }>(mailRoute(expert), { method: "POST", token, body: draft, timeoutMs: MAIL_SEND_TIMEOUT_MS }),
  // Goes to the sender of the message, in its thread: no recipient and no subject to give.
  mailReply: (token: string, expert: string, messageId: string, draft: Pick<MailDraft, "text" | "attachments">) =>
    call<{ messageId: string; threadId: string; from: string }>(`${mailRoute(expert, messageId)}/reply`, { method: "POST", token, body: draft, timeoutMs: MAIL_SEND_TIMEOUT_MS }),
  mailAttachment: (token: string, expert: string, messageId: string, attachmentId: string) => stream(mailRoute(expert, messageId, attachmentId), token),
  // Admins only: every inbox of the workspace and its three settings.
  mailRights: async (token: string) => (await call<{ items: MailRights[] }>("/app/mail/rights", { token })).items,
  setMailRights: (token: string, expert: string, patch: MailRightsPatch) => {
    if (!mailPath(expert)) throw new BackofficeError(404, "not_found", "Cette boîte est introuvable.");
    return call<MailRights>(`/app/mail/rights/${expert}`, { method: "PUT", token, body: patch });
  },

  // The client's model keys. The back office checks a key with its provider, encrypts it, installs
  // it on the instances in the background and watches it; it reads the caller's role on the session
  // and refuses with a code the route turns into a sentence (src/lib/llm.ts). A key never comes back.
  llm: (token: string) => call<LlmOverview>("/app/llm", { token }),
  // The model the caller picks among Yelema's own, for their instance or one of their experts.
  setLlmModel: (token: string, choice: LlmModelChoice) =>
    call<LlmWritten>("/app/llm/own/model", { method: "PUT", token, body: choice, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),
  setLlmSettings: (token: string, settings: { membersMayBringKey: boolean }) =>
    call<{ membersMayBringKey: boolean }>("/app/llm/settings", { method: "PUT", token, body: settings }),
  // Several accounts per provider and their order (backup accounts and models). `scope` is checked
  // into `own`, `client` or a member id before it reaches a path.
  addLlmAccount: (token: string, scope: string, draft: AccountDraft) =>
    call<{ ok: true; state: "pending" | "applied"; account: LlmAccount }>(`/app/llm/accounts?scope=${encodeURIComponent(scope)}`, { method: "POST", token, body: draft, timeoutMs: SETTING_WRITE_TIMEOUT_MS * 2 }),
  claudeAuth: (token: string, member: string | null) => call<ClaudeAuthStatus>(`/app/claude-code/auth${memberQuery(member)}`, { token, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),
  startClaudeAuth: (token: string, member: string | null) => call<ClaudeLogin>(`/app/claude-code/auth${memberQuery(member)}`, { method: "POST", token, body: { method: "subscription" }, timeoutMs: CLAUDE_LOGIN_TIMEOUT_MS }),
  logoutClaudeAuth: (token: string, member: string | null) => call<{ ok: true; auth: ClaudeAuth }>(`/app/claude-code/auth${memberQuery(member)}`, { method: "DELETE", token, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),
  submitClaudeCode: (token: string, member: string | null, code: string) => call<ClaudeLogin>(`/app/claude-code/auth/code${memberQuery(member)}`, { method: "POST", token, body: { code }, timeoutMs: CLAUDE_LOGIN_TIMEOUT_MS }),
  putClaudeKey: (token: string, member: string | null, key: string, label: string | null) => call<{ ok: true } & ClaudeAuthStatus>(`/app/claude-code/auth/key${memberQuery(member)}`, { method: "PUT", token, body: { key, ...(label ? { label } : {}) }, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),
  deleteClaudeKey: (token: string, member: string | null, id: string | null) => call<{ ok: true } & ClaudeAuthStatus>(`/app/claude-code/auth/key${withQuery(memberQuery(member), "id", id)}`, { method: "DELETE", token, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),
  orderClaudeKeys: (token: string, member: string | null, ids: string[]) => call<{ ok: true } & ClaudeAuthStatus>(`/app/claude-code/auth/order${memberQuery(member)}`, { method: "PUT", token, body: { ids }, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),
  claudeUsage: (token: string, member: string | null) => call<ClaudeUsage>(`/app/claude-code/auth/usage${memberQuery(member)}`, { token, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),
  llmAccount: (token: string, id: string) => call<LlmAccount>(`/app/llm/accounts/${id}`, { token, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),
  patchLlmAccount: (token: string, id: string, patch: { label?: string; secret?: string }) =>
    call<LlmWritten>(`/app/llm/accounts/${id}`, { method: "PATCH", token, body: patch, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),
  removeLlmAccount: (token: string, id: string) => call<LlmWritten>(`/app/llm/accounts/${id}`, { method: "DELETE", token }),
  llmModels: (token: string, scope: string, provider?: string) =>
    call<{ groups: ModelGroup[] }>(`/app/llm/models?scope=${encodeURIComponent(scope)}${provider ? `&provider=${encodeURIComponent(provider)}` : ""}`, { token, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),
  setLlmLayout: (token: string, scope: string, layout: LayoutDraft) =>
    call<LlmWritten>(`/app/llm/layout?scope=${encodeURIComponent(scope)}`, { method: "PUT", token, body: layout, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),

  // The client's own tool servers (MCP). The back office checks the name, the address and the
  // token, encrypts the token, writes the server on the instances in the background and never calls
  // the address itself; it reads the caller's role on the session and refuses with a code the route
  // turns into a sentence (src/lib/mcp-servers.ts). A token never comes back.
  // Site logins entrusted to one profile of an instance: read on the instance each time, never a password back.
  vaultOverview: (token: string) => call<VaultOverview>("/app/vault/own", { token, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),
  vault: (token: string, scope: VaultScope, profile: string) => {
    const path = vaultPath(scope, profile);
    if (!path) throw new BackofficeError(404, "not_found", "Profil introuvable.");
    return call<VaultList>(path, { token, timeoutMs: SETTING_WRITE_TIMEOUT_MS });
  },
  addVaultItem: (token: string, scope: VaultScope, profile: string, draft: VaultDraft) => {
    const path = vaultPath(scope, profile);
    if (!path) throw new BackofficeError(404, "not_found", "Profil introuvable.");
    return call<{ ok: true; item: VaultItem }>(path, { method: "POST", token, body: draft, timeoutMs: SETTING_WRITE_TIMEOUT_MS });
  },
  // Several Experts in one command on the instance (bounded at 120 s by the back office).
  addVaultItems: (token: string, profiles: string[], draft: VaultDraft) =>
    call<{ ok: true; items: VaultEntry[] }>("/app/vault/own", { method: "POST", token, body: { ...draft, profiles }, timeoutMs: VAULT_BATCH_TIMEOUT_MS }),
  removeVaultItems: (token: string, entries: VaultRef[]) =>
    call<{ ok: true; removed: number }>("/app/vault/own", { method: "DELETE", token, body: { entries }, timeoutMs: VAULT_BATCH_TIMEOUT_MS }),
  removeVaultItem: (token: string, scope: VaultScope, profile: string, handle: string) => {
    const path = vaultPath(scope, profile, handle);
    if (!path) throw new BackofficeError(404, "not_found", "Connexion introuvable.");
    return call<{ ok: true }>(path, { method: "DELETE", token, timeoutMs: SETTING_WRITE_TIMEOUT_MS });
  },
  // The member's Unipile messaging: the key only passes through to the instance, never comes back.
  unipile: (token: string) => call<UnipileStatus>("/app/unipile", { token, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),
  testUnipile: (token: string, draft: UnipileDraft) => call<{ accounts: UnipileAccount[] }>("/app/unipile/test", { method: "POST", token, body: draft, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),
  setUnipile: (token: string, draft: UnipileDraft) => call<UnipileStatus>("/app/unipile", { method: "PUT", token, body: draft, timeoutMs: 60_000 }),
  // The Experts who reach the messaging, the key already on the instance kept (Leslie, 01/11: no DSN and key typed again).
  setUnipileExperts: (token: string, experts: string[]) => call<UnipileStatus>("/app/unipile/experts", { method: "PUT", token, body: { experts }, timeoutMs: 60_000 }),
  clearUnipile: (token: string) => call<{ ok: true }>("/app/unipile", { method: "DELETE", token, timeoutMs: 60_000 }),
  // A one-click Unipile link, made by the instance (it alone holds the key), to link a broken account again.
  reconnectUnipile: (token: string, accountId: string) => call<{ url: string }>("/app/unipile/reconnect", { method: "POST", token, body: { accountId }, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),
  mcp: (token: string) => call<McpOverview>("/app/mcp", { token }),
  addMcpServer: (token: string, scope: SettingScope, draft: McpServerDraft) => {
    const path = mcpScopePath(scope);
    if (!path) throw new BackofficeError(404, "not_found", "Ce membre est introuvable.");
    return call<McpWritten>(path, { method: "POST", token, body: draft, timeoutMs: SETTING_WRITE_TIMEOUT_MS });
  },
  removeMcpServer: (token: string, scope: SettingScope, serverId: string) => {
    const path = mcpServerPath(scope, serverId);
    if (!path) throw new BackofficeError(404, "not_found", "Ce serveur est introuvable.");
    return call<McpWritten>(path, { method: "DELETE", token });
  },
  // OAuth of a tool server, always on the caller's own instance: the back office drives Hermes's
  // login there and relays the provider's return; the tokens never leave the instance.
  mcpOauth: (token: string) => call<{ servers: McpOauthServer[] }>("/app/mcp/oauth", { token, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),
  startMcpOauth: (token: string, serverId: string) => {
    if (!isServerId(serverId)) throw new BackofficeError(404, "not_found", "Ce serveur est introuvable.");
    return call<{ authorizationUrl: string }>(`/app/mcp/oauth/${serverId}`, { method: "POST", token, timeoutMs: MCP_OAUTH_TIMEOUT_MS });
  },
  finishMcpOauth: (token: string, query: McpOauthQuery) =>
    call<{ name: string; connected: boolean }>("/app/mcp/oauth/callback", { method: "POST", token, body: query, timeoutMs: MCP_OAUTH_TIMEOUT_MS }),
  // The client's transcription keys (Intégrations › Voix): kept by the back office, never on an instance.
  voiceKeys: (token: string) => call<VoiceKeysOverview>("/app/voice/keys", { token }),
  putVoiceKey: (token: string, scope: SettingScope, draft: { provider: string; secret: string }) => {
    const path = voiceKeyPath(scope);
    if (!path) throw new BackofficeError(404, "not_found", "Ce membre est introuvable.");
    return call<{ ok: true; verified: boolean }>(path, { method: "PUT", token, body: draft, timeoutMs: SETTING_WRITE_TIMEOUT_MS });
  },
  removeVoiceKey: (token: string, scope: SettingScope, provider: string) => {
    const path = voiceKeyPath(scope, provider);
    if (!path) throw new BackofficeError(404, "not_found", "Cette clé est introuvable.");
    return call<{ ok: true }>(path, { method: "DELETE", token });
  },
  // What the servers expose, surveyed on the instances (never by the app): to recommend.
  mcpTools: (token: string) => call<McpToolsOverview>("/app/mcp/tools", { token }),
  refreshMcpTools: (token: string) => call<McpToolsReport>("/app/mcp/tools/refresh", { method: "POST", token, timeoutMs: MCP_OAUTH_TIMEOUT_MS }),
  cancelMcpOauth: (token: string) => call<{ ok: true }>("/app/mcp/oauth", { method: "DELETE", token, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),

  // The company memory. The two reads are made in an instance's name, like reportComposioCalls: the
  // back office maps the token to its member and answers only from the compartments the org chart
  // opens to that member. A reasoned answer goes through a model on the provider's side.
  // `profile`: the expert asking, when its instance says which one (header X-Yelema-Profile).
  // Chat d'entreprise : whose apps an agent (`u-…`) of the enterprise instance calls — its own member's account.
  // The member's connected accounts: e-mail read once by the back office, label, default per tool, author.
  connectorAccounts: (token: string) => call<{ accounts: BoConnectorAccount[] }>("/app/integrations/connections", { token }),
  recordConnectorAccount: (token: string, body: { connectedAccountId: string; toolkit: string }) =>
    call<BoConnectorAccount>("/app/integrations/connections", { method: "POST", token, body }),
  updateConnectorAccount: (token: string, id: string, body: { label?: string | null; isDefault?: boolean }) =>
    call<{ accounts: BoConnectorAccount[] }>(connectorAccountPath(id), { method: "PATCH", token, body }),
  // In the instance's name: the default account of each tool, pinned in the experts' Composio session.
  appsAccounts: (instanceToken: string, workspace: string, profile?: string) =>
    call<{ user: string | null; defaults: Record<string, string> }>("/app/apps/accounts", { method: "POST", token: instanceToken, workspace, body: profile ? { profile } : {}, timeoutMs: 5_000 }),
  seatAppsUser: (instanceToken: string, workspace: string, profile: string) =>
    call<{ user: string }>("/app/apps/seat", { method: "POST", token: instanceToken, workspace, body: { profile } }),
  memoryAsk: (instanceToken: string, workspace: string, question: string, profile?: string) =>
    call<{ answer: string | null }>("/app/memory/ask", { method: "POST", token: instanceToken, workspace, body: { question, profile }, timeoutMs: MEMORY_ASK_TIMEOUT_MS }),
  memorySearch: (instanceToken: string, workspace: string, query: string, limit?: number, profile?: string) =>
    call<{ items: { title: string; excerpt: string }[] }>("/app/memory/search", { method: "POST", token: instanceToken, workspace, body: { query, limit, profile }, timeoutMs: MEMORY_ASK_TIMEOUT_MS }),
  // The company profile: where it stands for any member, the logo for a workspace admin only.
  companyProfile: (token: string) => call<CompanyProfile>("/app/workspace/profile", { token }),
  uploadLogo: (token: string, form: FormData) => call<CompanyProfile>("/app/workspace/logo", { method: "POST", token, form, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),
  removeLogo: (token: string) => call<CompanyProfile>("/app/workspace/logo", { method: "DELETE", token }),
  // Several images of the logo, where the back office keeps them (`logos` in the profile): one more
  // image, the main one (shown in the bar, `logoUrl`), one removed. Each answers the profile.
  addLogo: (token: string, form: FormData) => call<CompanyProfile>("/app/workspace/logos", { method: "POST", token, form, timeoutMs: SETTING_WRITE_TIMEOUT_MS }),
  setMainLogo: (token: string, id: string) => call<CompanyProfile>(ownPath("/app/workspace/logos", id), { method: "PATCH", token, body: { primary: true } }),
  removeLogoImage: (token: string, id: string) => call<CompanyProfile>(ownPath("/app/workspace/logos", id), { method: "DELETE", token }),
  // What the member reads, and where they may deposit. Deposits are sent to the memory in the
  // background: `status` goes from pending to synced.
  // Members' messaging: where the client's relay is, who is reachable, which devices are admitted.
  buzz: (token: string) => call<BuzzOverview>("/app/buzz", { token }),
  buzzAddDevice: (token: string, device: { pubkey: string; label: string }) => call<{ ok: true }>("/app/buzz/devices", { method: "POST", token, body: device }),
  buzzRemoveDevice: (token: string, pubkey: string) => call<{ ok: true }>("/app/buzz/devices", { method: "DELETE", token, body: { pubkey } }),
  buzzSalon: (token: string, salon: { nom: string; cles: string[] }) => call<{ id: string; nom: string }>("/app/buzz/salons", { method: "POST", token, body: salon, timeoutMs: 90_000 }),
  buzzRenameSalon: (token: string, id: string, nom: string) => call<{ id: string; nom: string }>(`/app/buzz/salons/${encodeURIComponent(id)}`, { method: "PATCH", token, body: { nom }, timeoutMs: 60_000 }),
  buzzDeleteSalon: (token: string, id: string) => call<{ ok: true }>(`/app/buzz/salons/${encodeURIComponent(id)}`, { method: "DELETE", token, timeoutMs: 60_000 }),
  buzzAddSalonMembers: (token: string, id: string, cles: string[]) => call<{ ok: true; ajoutes: number }>(`/app/buzz/salons/${encodeURIComponent(id)}/membres`, { method: "POST", token, body: { cles }, timeoutMs: 90_000 }),
  buzzSalonDeliverables: (token: string, id: string) => call<{ items: SalonDeliverable[] }>(`/app/buzz/salons/${encodeURIComponent(id)}/livrables`, { token, timeoutMs: 30_000 }),
  buzzSent: (token: string, sent: { kind: string; recipients: string[] }) => call<{ ok: true }>("/app/buzz/outbox", { method: "POST", token, body: sent }),
  memoryItems: (token: string) => call<MemoryList>("/app/memory/items", { token }),
  createMemoryNote: (token: string, note: MemoryNote) => call<{ id: string }>("/app/memory/items", { method: "POST", token, body: note }),
  uploadMemoryDocument: (token: string, form: FormData) => call<{ id: string }>("/app/memory/items", { method: "POST", token, form, timeoutMs: MAIL_SEND_TIMEOUT_MS }),
  updateMemoryItem: (token: string, id: string, patch: MemoryPatch) => call<{ ok: true }>(ownPath("/app/memory/items", id), { method: "PATCH", token, body: patch }),
  deleteMemoryItem: (token: string, id: string) => call<{ ok: true }>(ownPath("/app/memory/items", id), { method: "DELETE", token }),
  // A new file for a deposited document; the back office keeps the old one as the previous version.
  uploadMemoryVersion: (token: string, id: string, form: FormData) =>
    call<{ id: string; version: number }>(`${ownPath("/app/memory/items", id)}/versions`, { method: "POST", token, form, timeoutMs: MAIL_SEND_TIMEOUT_MS }),
  // The document of a deposit, as a stream for the route to pipe. 404 when the member does not read its compartment.
  memoryDocument: (token: string, id: string) => stream(`${ownPath("/app/memory/items", id)}/file`, token),

  // The org chart that walls the memory, for the workspace's admins. The back office keeps it; the
  // app holds no copy.
  org: (token: string) => call<BackofficeOrgChart>("/app/org", { token }),
  createUnit: (token: string, unit: { name: string; parent?: string | null }) => call<{ id: string }>("/app/org/units", { method: "POST", token, body: unit }),
  updateUnit: (token: string, id: string, patch: { name?: string; parent?: string | null }) => call<{ ok: true }>(ownPath("/app/org/units", id), { method: "PATCH", token, body: patch }),
  deleteUnit: (token: string, id: string) => call<{ ok: true }>(ownPath("/app/org/units", id), { method: "DELETE", token }),
  placeMember: (token: string, id: string, place: { unit?: string | null; unitRole?: "member" | "head" }) =>
    call<{ ok: true }>(ownPath("/app/org/members", id), { method: "PATCH", token, body: place }),
  // A member's place, or one expert's, in a unit; 409 for the same place twice.
  createAssignment: (token: string, draft: OrgAssignmentDraft) => call<{ id: string }>("/app/org/assignments", { method: "POST", token, body: draft }),
  updateAssignment: (token: string, id: string, patch: { role?: OrgRole; unit?: string }) =>
    call<{ ok: true }>(ownPath("/app/org/assignments", id), { method: "PATCH", token, body: patch }),
  deleteAssignment: (token: string, id: string) => call<{ ok: true }>(ownPath("/app/org/assignments", id), { method: "DELETE", token }),
  createGrant: (token: string, grant: OrgGrantDraft) => call<{ id: string }>("/app/org/grants", { method: "POST", token, body: grant }),
  deleteGrant: (token: string, id: string) => call<{ ok: true }>(ownPath("/app/org/grants", id), { method: "DELETE", token }),
};

// The route of a setting's scope, or a 404: a member id that is not a plain number never reaches
// the back office's URL.
function settingPath(base: string, scope: SettingScope): string {
  const path = scopePath(base, scope);
  if (!path) throw new BackofficeError(404, "not_found", "Ce membre est introuvable.");
  return path;
}

function ownPath(base: string, id: string): string {
  if (!isPublicId(id)) throw new BackofficeError(404, "not_found", "Cet élément est introuvable.");
  return `${base}/${id}`;
}

// A file from the back office, handed back unread so the caller can pipe it.
async function stream(path: string, token: string): Promise<Response> {
  const unavailable = () =>
    new BackofficeError(503, "unavailable", "Le service est momentanément indisponible. Réessayez dans un instant.");
  const res = await send(path, { headers: { Authorization: `Bearer ${token}` } });
  if (res.ok && res.body) return res;
  const text = await res.text().catch(() => "");
  if (res.status === 401 || res.status === 403) throw new BackofficeError(res.status, "forbidden", "Cette action n’est pas autorisée.");
  if (res.status === 404) throw new BackofficeError(404, "not_found", "Ce document n’est pas disponible.");
  console.error(`[backoffice] ${path}: ${res.status}`, text.slice(0, 300));
  throw unavailable();
}
