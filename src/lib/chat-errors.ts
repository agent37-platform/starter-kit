import { mediaTags } from "./media-tags.ts";

// The instance's own failure text is technical and in English: the member reads a French sentence.
// A known cause gets its own; anything else keeps the caller's generic one.

const BUDGET = /budget_exceeded|budget has been exceeded/i;

export const BUDGET_EXCEEDED = "Le budget du moteur Yelema de votre entreprise est atteint ce mois-ci. Votre administrateur peut l’augmenter ou brancher un compte.";

// The provider refuses for want of credit on the account the experts run on (key or subscription).
const CREDIT = /insufficient[_ ]?(quota|credits?|balance|funds)|credit balance is too low|quota[_ ]exceeded|exceeded your current quota|payment[_ ]required|billing/i;

export const CREDIT_EXHAUSTED = "Le compte d’IA de vos Experts n’a plus de crédit. Rechargez-le, ou branchez un autre compte dans Intégrations, Modèles.";

// The browser's own words when a request never reached the server: Safari « Load failed », Chrome
// « Failed to fetch », Firefox « NetworkError… » (Leslie, 28/10: Wi-Fi cut, « Load failed » on top of the chat).
const NETWORK = /^(load failed|failed to fetch|networkerror when attempting to fetch resource\.?|network ?error|the network connection was lost\.?|the internet connection appears to be offline\.?)$/i;

export const OFFLINE = "Pas de connexion Internet. Vérifiez votre Wi-Fi ou vos données mobiles, puis réessayez.";
export const UNREACHABLE = "Yelema ne répond pas pour le moment. Réessayez dans un instant.";

/**
 * The sentence for a failed answer whose raw reason is `raw`. `online` is the browser's word on the
 * network at that moment (navigator.onLine): a request that never got through says which side failed.
 */
export function chatFailureMessage(raw: string | undefined | null, fallback: string, online = true): string {
  if (raw && NETWORK.test(raw.trim())) return online ? UNREACHABLE : OFFLINE;
  const stop = raw ? engineStop(raw) : undefined;
  if (stop) return stop;
  if (raw && BUDGET.test(raw)) return BUDGET_EXCEEDED;
  if (raw && CREDIT.test(raw)) return CREDIT_EXHAUSTED;
  return fallback;
}

/**
 * A request that never reached the server (the browser's TypeError, or its words for it), put in a
 * French sentence; null for anything else, an abort included (the caller stopped it on purpose).
 */
export function networkFailure(e: unknown, online = true): string | null {
  if (e instanceof Error && e.name === "AbortError") return null;
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (e instanceof TypeError || NETWORK.test(raw.trim())) return online ? UNREACHABLE : OFFLINE;
  return null;
}

/** Whether a failure sentence says the model account must be topped up: the bell names it so. */
export const isAccountToTopUp = (sentence: string | null | undefined) => sentence === CREDIT_EXHAUSTED || sentence === BUDGET_EXCEEDED;

// Lines the agent's runtime writes into a reply for itself, in English: never for the member.
const RUNTIME_LINES = [
  /^\s*(\[?system\]?\s*:?\s*)?your previous response was truncated\b.*$/i,
  /^\s*(\[?system\]?\s*:?\s*)?your request was not processed\b.*$/i,
  /^\s*[^\w\s]{0,3}\s*command invoked\b.*$/i,
  // A delegated task's own notices (Djénéba's audit, 29/10): « ASYNC DELEGATION BATCH COMPLETE »,
  // « Task … completed. Check the result ».
  /^\s*[^\w\s]{0,3}\s*\[?\s*async delegation\b.*$/i,
  /^\s*[^\w\s]{0,3}\s*task\b.{0,120}\b(completed|failed)\b.*$/i,
  /^\s*[^\w\s]{0,3}\s*check the result\b.*$/i,
];

// The marker an expert writes for itself when it hands work to a colleague: « [DÉLÉGUER] », « [DÉLÉGUER → Salif] ».
const HANDOFF_MARK = /\[\s*d[ée]l[ée]guer\b[^\]\n]*\]\s*/gi;

// The runtime's own words when it ends a turn early (model wait, tool loop guard, step budget, internal
// error): the member reads what happened in French. Hermes may follow them with a « Details: » line.
export const INTERRUPTED_REPLY = "Ma réponse a été interrompue avant la fin. Renvoyez votre message et je reprends.";
export const LOOP_STOPPED_REPLY = "Je me suis arrêté : je répétais la même opération sans avancer. Dites-moi comment poursuivre.";
export const OUT_OF_STEPS_REPLY = "J’ai atteint le nombre d’étapes prévu pour cette réponse avant de terminer. Écrivez « continue » et je reprends.";
const ENGINE_STOPS: [RegExp, string][] = [
  [/^\s*[^\w\s]{0,3}\s*operation interrupted\b/i, INTERRUPTED_REPLY],
  [/^\s*i stopped retrying because i kept running\b/i, LOOP_STOPPED_REPLY],
  [/^\s*(i ran out of steps for this turn|i reached the iteration limit)\b/i, OUT_OF_STEPS_REPLY],
  [/^\s*[^\w\s]{0,3}\s*(hermes hit (repeated errors|an internal error)|no reply: the turn stopped|this turn did not complete)\b/i, INTERRUPTED_REPLY],
];
const engineStop = (line: string): string | undefined => ENGINE_STOPS.find(([re]) => re.test(line))?.[1];
const STOP_DETAILS = /^\s*details:/i;

/**
 * A member's message as they wrote it: when an answer is cut, the runtime appends its own English
 * order to it (« [System: Your previous response was truncated…] », Leslie 26/10), never theirs.
 */
export function cleanUserMessage(text: string): string {
  const kept = text.split("\n").filter((line) => !RUNTIME_LINES.some((re) => re.test(line)));
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// The runtime appends the turn's files to the member's message as it saves it (« [Attached files:\n- /home/node/
// Livrables/Pièces jointes/62b69t5b-pack.zip] »): reloaded, the bubble showed the paths (Leslie, 27/10).
const ATTACHED = /\n*\[Attached files:\n((?:- [^\n]*\n?)+)\]\s*$/;
// The upload route names a file `<8 random characters>-<original name>` in « Pièces jointes ».
const UPLOAD_PREFIX = /^[a-z0-9]{8}-/;
const IMAGE = /\.(png|jpe?g|gif|webp|heic|bmp|svg)$/i;

/** A saved member message split into what they wrote and the files that rode along, as chips. */
export function attachedFiles(text: string): { text: string; files: { name: string; path: string; isImage: boolean }[] } {
  const m = ATTACHED.exec(text);
  if (!m) return { text, files: [] };
  const files = m[1]
    .split("\n")
    .map((line) => line.replace(/^- /, "").trim())
    .filter(Boolean)
    .map((path) => {
      const base = path.split("/").pop() || path;
      const name = path.includes("/Pièces jointes/") ? base.replace(UPLOAD_PREFIX, "") : base;
      return { name, path, isImage: IMAGE.test(name) };
    });
  return { text: text.slice(0, m.index).trimEnd(), files };
}

/** A reply as the member reads it: the runtime's English lines and MEDIA tags out, the same paragraph never twice in a row. */
export function cleanReply(text: string): string {
  const kept: string[] = [];
  let stopped = false;
  for (const line of mediaTags(text).text.replace(HANDOFF_MARK, "").split("\n")) {
    const stop = engineStop(line);
    if (stop) kept.push(stop);
    else if (!(stopped && STOP_DETAILS.test(line)) && !RUNTIME_LINES.some((re) => re.test(line))) kept.push(line);
    if (line.trim()) stopped = !!stop;
  }
  const paragraphs = kept.join("\n").split(/\n{2,}/);
  const out = paragraphs.filter((p, i) => !p.trim() || i === 0 || p.trim() !== paragraphs[i - 1].trim());
  return out.join("\n\n").replace(/^\s+|\s+$/g, "");
}
