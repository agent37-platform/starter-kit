// An approval the expert asks for during a turn (image yelema-hermes I65): `response.approval_requested`,
// answered by POST …/responses/{id}/approval. Its text comes from the model: shown as text, never as HTML.

export type ApprovalChoice = "once" | "always" | "deny";
export type ApprovalState = "pending" | "sending" | "answered" | "expired";

export interface ApprovalRequest {
  requestId: string;
  message: string;
  choices: ApprovalChoice[];
  /** ms since the epoch; past it the instance has already refused. */
  expiresAt: number;
  state: ApprovalState;
  choice?: ApprovalChoice;
  /** Given by the app: the member already said yes in the « Envoyer » window. */
  auto?: boolean;
}

// Card texts the guard of the image builds for a send (yelema-context `garde_outils.py`), destination after.
// Only these are given on the member's behalf: a reply, a forward, a deletion or a batch keeps its card.
const AUTO_SENDS = [
  /^Envoyer un e-mail depuis la boîte de votre expert à (.+)$/,
  /^Envoyer un message avec (?:Gmail|Outlook) : (.+)$/,
  /^Écrire à quelqu'un sur WhatsApp ou LinkedIn : (.+)$/,
  /^Envoyer un message WhatsApp ou LinkedIn dans une discussion existante : (.+)$/,
];

const destinationOf = (message: string): string | null => {
  for (const re of AUTO_SENDS) {
    const m = re.exec(message.trim());
    if (m) return m[1].trim();
  }
  return null;
};

/**
 * True when an approval asked during a turn may be given at once: the turn was sent by the « Envoyer » window
 * (its click is the agreement, Leslie 17/11), the request is one plain send, and every recipient it names is
 * one the window named.
 */
export function autoApproves(turnTexts: readonly string[], approvalMessage: string, isDialogSend: (t: string) => boolean): boolean {
  const dest = destinationOf(approvalMessage);
  if (!dest) return false;
  const asked = turnTexts.filter(isDialogSend).map((t) => t.split("\n")[0].toLowerCase());
  const parts = dest.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
  return parts.length > 0 && asked.some((line) => parts.every((p) => named(line, p)));
}

// Whole recipient only: « a@b.c » is not named by « à a@b.ci ».
const named = (line: string, who: string): boolean => {
  const at = line.indexOf(` ${who}`);
  if (at < 0) return false;
  const after = line.charAt(at + who.length + 1);
  return after === "" || /[\s,;]/.test(after);
};

export const APPROVAL_CHOICES: readonly ApprovalChoice[] = ["once", "always", "deny"];
export const MODIFY_PREFIX = "Modifie plutôt : ";
const MAX_MESSAGE = 2000;
const DEFAULT_WAIT_MS = 300_000;

export const isApprovalChoice = (v: unknown): v is ApprovalChoice => typeof v === "string" && (APPROVAL_CHOICES as readonly string[]).includes(v);

/** The event's data, checked; null when it names no request. */
export function parseApproval(data: Record<string, unknown>, now = Date.now()): ApprovalRequest | null {
  const requestId = typeof data.request_id === "string" ? data.request_id.trim() : "";
  if (!requestId || requestId.length > 256) return null;
  const raw = typeof data.message === "string" ? data.message.trim() : "";
  const message = raw.length > MAX_MESSAGE ? `${raw.slice(0, MAX_MESSAGE)}…` : raw;
  const listed: unknown[] = Array.isArray(data.choices) ? data.choices : [];
  const choices = APPROVAL_CHOICES.filter((c) => listed.includes(c));
  const expires = typeof data.expires_at === "string" ? Date.parse(data.expires_at) : NaN;
  return {
    requestId,
    message: message || "Votre Expert demande votre accord avant d’agir.",
    choices: choices.includes("once") && choices.includes("deny") ? choices : ["once", "deny"],
    expiresAt: Number.isFinite(expires) ? expires : now + DEFAULT_WAIT_MS,
    state: "pending",
  };
}

/** Adds a request once (a reattached stream replays it). */
export function addApproval(list: ApprovalRequest[] | undefined, a: ApprovalRequest): ApprovalRequest[] {
  const all = list ?? [];
  return all.some((x) => x.requestId === a.requestId) ? all : [...all, a];
}

/** Sets one request's state (and the choice made). */
export function settleApproval(list: ApprovalRequest[] | undefined, requestId: string, state: ApprovalState, choice?: ApprovalChoice): ApprovalRequest[] {
  return (list ?? []).map((a) => (a.requestId === requestId ? { ...a, state, ...(choice ? { choice } : {}) } : a));
}

/** Turn over: nothing still waiting can be answered any more. */
export function expireOpen(list: ApprovalRequest[] | undefined): ApprovalRequest[] | undefined {
  return list?.map((a) => (a.state === "pending" || a.state === "sending" ? { ...a, state: "expired" } : a));
}

export const isOpen = (a: ApprovalRequest, now = Date.now()): boolean => a.state === "pending" && now < a.expiresAt;

/** The member's answer, once the instance replied: 409 means the request no longer waits. */
export function answerOutcome(status: number): ApprovalState | "error" {
  if (status >= 200 && status < 300) return "answered";
  return status === 409 ? "expired" : "error";
}
