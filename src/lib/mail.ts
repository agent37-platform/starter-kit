// Types and checks of the experts' e-mail relayed to the back office: one inbox per instance and per expert.

export interface MailInbox {
  /** Catalogue key of the expert the inbox belongs to. */
  expert: string;
  /** Instance the inbox belongs to, when it has one. */
  agentId?: string;
  address: string;
  /** The expert is allowed to send at all. */
  sendEnabled: boolean;
  /** This member may have the expert send; recipients and the daily cap are checked on sending. */
  canSend: boolean;
  /** Recipients outside the company are allowed. */
  externalAllowed: boolean;
}

export interface MailSummary {
  /** Opaque, URL-safe: the provider's own id never rides a path. */
  id: string;
  threadId: string;
  from: string;
  to: string[];
  subject: string;
  preview: string;
  at: string;
  labels: string[];
  attachments: number;
}

export interface MailAttachment {
  id: string;
  filename: string;
  size: number;
  contentType: string;
}

export interface MailDetail extends Omit<MailSummary, "preview" | "attachments"> {
  cc: string[];
  text: string;
  /** As the sender wrote it, NOT sanitised: only ever shown through `sandboxedMail`. */
  html: string;
  attachments: MailAttachment[];
}

export interface MailRights {
  expert: string;
  address: string | null;
  status: "pending" | "active" | "suspended";
  sendEnabled: boolean;
  /** Members the inbox is restricted to, by e-mail; none means every member who has the expert. */
  senders: string[];
  externalAllowed: boolean;
  /** Active members who have this expert: the only ones that can be named. */
  eligible: string[];
}

export interface MailOutgoingAttachment {
  filename: string;
  contentType: string;
  /** Base64, no data: prefix. */
  content: string;
}

export interface MailDraft {
  to: string[];
  subject: string;
  text: string;
  attachments?: MailOutgoingAttachment[];
}

export type MailRightsPatch = Partial<Pick<MailRights, "sendEnabled" | "senders" | "externalAllowed">>;

/** Who carries an inbox: the member's own instance, or, for an admin, a member named by e-mail (the app shows no one else's instance id). */
export type MailTarget = { agentId: string } | { member: string };

export type CreateMailInboxInput = MailTarget & { expert: string; displayName?: string };

const EXPERT_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const OPAQUE_ID = /^[A-Za-z0-9_-]{1,600}$/;
const ADDRESS = /^[^\s@<>"',;:\\]{1,64}@[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?\.[a-z]{2,24}$/i;

/**
 * The back office's path for an inbox, a message or an attachment, or null when a segment is not in
 * its plain form: nothing a browser sent goes into that URL unchecked.
 */
export function mailPath(expert: string, messageId?: string, attachmentId?: string): string | null {
  if (!EXPERT_KEY.test(expert)) return null;
  const base = `/app/mail/inboxes/${expert}/messages`;
  if (messageId === undefined) return base;
  if (!OPAQUE_ID.test(messageId)) return null;
  if (attachmentId === undefined) return `${base}/${messageId}`;
  return OPAQUE_ID.test(attachmentId) ? `${base}/${messageId}/attachments/${attachmentId}` : null;
}

export const isExpertKey = (value: string): boolean => EXPERT_KEY.test(value);

export const isMailAgentId = (value: string): boolean => AGENT_ID_RE.test(value);

/** `agentId` or `member` from a query or a body, checked; null when neither, both, or a malformed one. */
export function parseMailTarget(agentId: unknown, member: unknown): MailTarget | null {
  if ((agentId == null) === (member == null)) return null;
  if (typeof agentId === "string") return AGENT_ID_RE.test(agentId) ? { agentId } : null;
  if (typeof member !== "string") return null;
  const email = member.trim().toLowerCase();
  return email.length <= 254 && ADDRESS.test(email) ? { member: email } : null;
}

/** The back office's query for a target (`agentId=…` or `member=…`). */
export const mailTargetQuery = (t: MailTarget): string => new URLSearchParams(t).toString();

/** The inbox of an expert on an instance, among those the back office listed for the member. */
export function inboxOf(inboxes: readonly MailInbox[], expert: string, agentId: string): MailInbox | null {
  return inboxes.find((i) => i.expert === expert && (!i.agentId || i.agentId === agentId)) ?? null;
}

/**
 * Initiales ASCII en minuscules du nom d'un utilisateur (« Christy B. » → « cb »), ou les deux premiers
 * caractères alphanumériques d'un nom d'un seul mot ou de la partie locale d'un e-mail ; partie
 * `{initiales}` des adresses `{expert}.{initiales}.{entreprise}`.
 */
export function userInitials(nameOrEmail: string): string {
  const local = nameOrEmail.includes("@") ? nameOrEmail.slice(0, nameOrEmail.indexOf("@")) : nameOrEmail;
  const ascii = local
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const words = ascii.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`;
  if (words.length === 1) return words[0].slice(0, 2);
  return "u";
}

const MAX_DISPLAY_NAME_LENGTH = 60;

/**
 * Strips characters AgentMail rejects in `display_name` (punctuation other than `.`, `'`, `-`)
 * and bounds length. Returns undefined when nothing usable remains.
 */
export function sanitizeInboxDisplayName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(/[^\p{L}\p{N} .'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH)
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

const record = (body: unknown): Record<string, unknown> | null =>
  body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;

/** The request to create an expert's inbox, checked; null when it is not one. */
export function parseCreateMailInboxInput(body: unknown): CreateMailInboxInput | null {
  const r = record(body);
  if (!r || typeof r.expert !== "string" || !EXPERT_KEY.test(r.expert)) return null;
  const target = parseMailTarget(r.agentId, r.member);
  if (!target) return null;
  const displayName = sanitizeInboxDisplayName(r.displayName);
  return { expert: r.expert, ...target, ...(displayName !== undefined ? { displayName } : {}) };
}

const MAX_SUBJECT_LENGTH = 998;
const MAX_ATTACHMENTS = 20;
const MAX_FILENAME_LENGTH = 255;
const CONTENT_TYPE = /^[\w.+-]{1,63}\/[\w.+-]{1,63}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
// Line breaks and other control characters, which would start a new header line.
const CONTROL = /[\u0000-\u001f\u007f]+/g;

/** Attachments of a draft, checked; null when one is not a named, typed, base64 file. */
function parseAttachments(value: unknown): MailOutgoingAttachment[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) return null;
  const out: MailOutgoingAttachment[] = [];
  for (const a of value) {
    const r = record(a);
    if (!r || typeof r.filename !== "string" || typeof r.contentType !== "string" || typeof r.content !== "string") return null;
    const filename = r.filename.replace(CONTROL, " ").trim().slice(0, MAX_FILENAME_LENGTH);
    if (!filename || !CONTENT_TYPE.test(r.contentType) || !BASE64.test(r.content)) return null;
    out.push({ filename, contentType: r.contentType, content: r.content });
  }
  return out;
}

/** A new e-mail as the browser sent it, reduced to its fields and checked; null when it is not one. */
export function parseMailDraft(body: unknown): MailDraft | null {
  const r = record(body);
  if (!r || !Array.isArray(r.to) || typeof r.subject !== "string" || typeof r.text !== "string") return null;
  if (!r.to.every((t): t is string => typeof t === "string")) return null;
  const to = parseRecipients(r.to.join(" "));
  const attachments = parseAttachments(r.attachments);
  if (!to || !attachments) return null;
  const subject = r.subject.replace(CONTROL, " ").trim().slice(0, MAX_SUBJECT_LENGTH);
  return { to, subject, text: r.text, ...(attachments.length > 0 ? { attachments } : {}) };
}

/** A reply as the browser sent it, reduced to its text and attachments and checked; null when it is not one. */
export function parseMailReply(body: unknown): Pick<MailDraft, "text" | "attachments"> | null {
  const r = record(body);
  if (!r || typeof r.text !== "string") return null;
  const attachments = parseAttachments(r.attachments);
  if (!attachments) return null;
  return { text: r.text, ...(attachments.length > 0 ? { attachments } : {}) };
}

/** Addresses typed in one field, split on commas, semicolons and spaces. Null when one is not an address. */
export function parseRecipients(input: string): string[] | null {
  const parts = input.split(/[\s,;]+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 20) return null;
  const out: string[] = [];
  for (const part of parts) {
    const address = part.toLowerCase();
    if (address.length > 254 || !ADDRESS.test(address)) return null;
    if (!out.includes(address)) out.push(address);
  }
  return out;
}

/** "Koffi Yao <koffi@exemple.ci>" -> "koffi@exemple.ci". */
export function bareAddress(from: string): string {
  return (/<([^<>]+)>\s*$/.exec(from)?.[1] ?? from).trim();
}

/** Sent by the expert's inbox rather than received in it. */
export const isSent = (labels: readonly string[]): boolean => labels.includes("sent");

// Policy of the document shown in the message's sandboxed iframe: no script, no request but images,
// inline styles and inline fonts.
const MAIL_CSP = "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:";

/** The document to give the sandboxed iframe's `srcDoc`. */
export function sandboxedMail(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${MAIL_CSP}"><base target="_blank"><style>body{margin:0;padding:12px;font:14px/1.6 system-ui,sans-serif;color:#1b1b1f;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
}
