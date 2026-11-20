// The sessions the back-office opens for a phone call (warm-up, prepared session, questions and tasks
// asked during the call, its transcript): known by their first message, which the back-office keeps
// fixed (contract test `VOICE_SESSION_OPENERS` in control-plane). They stay out of the chat rail, except
// the call's own session (its transcript): it is the call's conversation (Leslie, 20/11, option A).
const OPENERS = [
  "Demande faite pendant un appel vocal",
  "Un appel vocal commence",
  "Préparation de ton prochain appel vocal",
  "Transcription exacte de l'appel vocal",
  "A request made during a voice call",
  "A voice call is starting",
  "Preparing your next voice call",
  "Exact transcript of the voice call",
];

export function isVoiceSession(preview: string | null | undefined): boolean {
  const p = (preview ?? "").trimStart();
  return OPENERS.some((o) => p.startsWith(o));
}

// The call's own session opens on its exact transcript: « …de l'appel vocal du 17/10/2026 à 14:05 UTC ».
const CALL_SESSION = /^(?:Transcription exacte de l'appel vocal|Exact transcript of the voice call)\b/;
export const isCallSession = (preview: string | null | undefined): boolean => CALL_SESSION.test((preview ?? "").trimStart());

const CALL_WHEN = /(?:du|of) (\d{1,2})\/(\d{1,2})\/(\d{4}) (?:à|at) (\d{1,2}):(\d{2}) UTC/;
/** When the call began, as written in its transcript's first line (UTC), in ms; null when not written. */
export function callStartOf(text: string | null | undefined): number | null {
  const m = CALL_WHEN.exec(text ?? "");
  if (!m) return null;
  const [, d, mo, y, h, mi] = m.map(Number);
  const t = Date.UTC(y, mo - 1, d, h, mi);
  return Number.isFinite(t) ? t : null;
}

/**
 * The call's conversation in the rail: « Appel du 20 nov. à 14:05 ». Named on the server (the phone app
 * reads the same list), in the hour of Abidjan where the members are; « Appel » without a date.
 */
export function callTitle(at: number | null, timeZone = "Africa/Abidjan"): string {
  if (at == null || !Number.isFinite(at)) return "Appel";
  const d = new Date(at);
  const day = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone });
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone });
  return `Appel du ${day} à ${time}`;
}
