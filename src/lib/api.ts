import { wipeDevice } from "@/lib/device-cache-client";
import { within } from "@/lib/first-screen";
import { networkFailure } from "@/lib/chat-errors";

// What the user reads when an answer carries no sentence of its own (a host's error page, a
// crashed route): never a status code or a raw body.
const FAILED = "Une erreur est survenue. Réessayez dans un instant.";

// Pages a visitor reaches without a session: a 401 there is an answer to what they typed (a wrong
// password, a spent link), not an expired session.
const PUBLIC_PAGES = /^\/(login|reset-password|invite|espace-)/;

// The session ended while the page was open (expired, or the member was suspended): every call now
// answers 401, and the screen would sit there with an error. Send the user to sign in instead, and
// back to where they were afterwards. True when the page is on its way out.
function leaveIfSignedOut(res: Response): boolean {
  if (res.status !== 401 || typeof window === "undefined") return false;
  if (PUBLIC_PAGES.test(window.location.pathname)) return false;
  const here = window.location.pathname + window.location.search;
  // Nothing of the ended session stays on the device, even if the sign-in page never loads (1 s at most).
  void within(wipeDevice(), 1_000).finally(() => window.location.assign(`/login?expired=1&next=${encodeURIComponent(here)}`));
  return true;
}

const EXPIRED = "Votre session a expiré. Reconnectez-vous.";

// A form or a file sets its own type (multipart boundary); anything else is sent as JSON.
const ownType = (body: RequestInit["body"]) => typeof FormData !== "undefined" && (body instanceof FormData || body instanceof Blob || body instanceof URLSearchParams || body instanceof ArrayBuffer);

/** A refusal of this app's API: its sentence, and the code and status it came with (`salons_closed`…). */
export class ApiFetchError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "ApiFetchError";
    this.status = status;
    this.code = code;
  }
}

/** `fallback`: the sentence (without its full stop) when a refusal carries none of its own. */
export async function apiFetch<T>(url: string, init?: RequestInit, fallback?: string): Promise<T> {
  // A request that never got through says so in French, never « Failed to fetch » or « Load failed »
  // (Leslie, 22/11: the raw words under the conversation filters).
  let res: Response;
  let text: string;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(ownType(init?.body) ? {} : { "Content-Type": "application/json" }), ...(init?.headers || {}) },
    });
    text = await res.text();
  } catch (e) {
    const sentence = networkFailure(e, typeof navigator === "undefined" || navigator.onLine);
    throw sentence ? new Error(sentence) : e;
  }
  // A proxy or a crashed route can answer with an HTML page: fall back to a plain sentence, not a
  // parse error or the page itself.
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (res.ok) throw new Error(FAILED);
      data = {};
    }
  }
  if (!res.ok) {
    if (leaveIfSignedOut(res)) throw new Error(EXPIRED);
    const error = (data as { error?: { message?: string; code?: unknown } })?.error;
    const code = typeof error?.code === "string" ? error.code : null;
    throw new ApiFetchError(error?.message || (fallback ? asSentence(fallback) : FAILED), res.status, code);
  }
  return data as T;
}

/**
 * What a member reads for a failure caught on screen: the refusal's own French sentence, or a French
 * sentence for a request that never got through; never the browser's « Failed to fetch ».
 */
export function errorText(e: unknown, fallback = FAILED): string {
  const network = networkFailure(e, typeof navigator === "undefined" || navigator.onLine);
  if (network) return network;
  return (e instanceof Error && e.message.trim()) || fallback;
}

// Pull the API's { error: { message } } off a non-ok Response for the manual fetch callers
// (streaming / multipart bodies that can't go through apiFetch), falling back to a status code.
export async function readApiError(res: Response, fallback: string): Promise<string> {
  if (leaveIfSignedOut(res)) return EXPIRED;
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return asSentence(body?.error?.message || fallback);
}

// A capital first, one final stop: never « .. » when the text already ends a sentence.
export function asSentence(text: string): string {
  const t = text.trim();
  if (!t) return t;
  const head = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(head) ? head : `${head}.`;
}
