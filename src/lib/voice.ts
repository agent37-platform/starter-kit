// Voice calls with an expert. The back office opens the call at Aethex and picks the agent; this app
// relays the signaling with the member's session (src/app/api/voice) and plays the audio in the browser.

export type VoiceLanguage = "fr" | "en";

export interface VoiceOption {
  key: string;
  label: string;
  language: VoiceLanguage;
  gender: "female" | "male" | "neutral";
  country: string;
  /** Public sample, playable without a key. */
  previewUrl: string;
  /** The voice a call in this language takes when none is chosen. */
  default: boolean;
}

export const VOICE_LANGUAGES: { id: VoiceLanguage; label: string }[] = [
  { id: "fr", label: "Français" },
  { id: "en", label: "Anglais" },
];

/** Signaling steps the SDK sends after `calls`, with the one method each takes. */
export const SIGNALING_METHOD = { offer: "POST", ice: "PATCH", status: "GET", end: "POST", feedback: "POST" } as const;
export type SignalingStep = keyof typeof SIGNALING_METHOD;

export const CONVERSATION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;
// An IANA time zone (« Africa/Abidjan », « America/Argentina/Buenos_Aires », « UTC »).
const TIME_ZONE = /^[A-Za-z][A-Za-z_]{0,29}(\/[A-Za-z0-9_+-]{1,30}){0,2}$/;

/** The step a relayed request names, or null when the path or the method is not one the SDK sends. */
export function signalingStep(id: string, action: string, method: string): SignalingStep | null {
  if (!CONVERSATION_ID.test(id) || !Object.hasOwn(SIGNALING_METHOD, action)) return null;
  const step = action as SignalingStep;
  return SIGNALING_METHOD[step] === method ? step : null;
}

/** The `X-Yelema-*` headers of a call, kept only when well-formed; the back office checks them again. */
export function callHeaders(h: Headers): Record<string, string> | null {
  const expert = h.get("x-yelema-expert")?.trim().toLowerCase() ?? "";
  const language = h.get("x-yelema-language")?.trim().toLowerCase() ?? "";
  const voice = h.get("x-yelema-voice")?.trim().toLowerCase() ?? "";
  // The member's time zone, for the expert to greet by their hour (Leslie, 18/11: « belle journée » at night). Dropped if malformed.
  const zone = h.get("x-yelema-timezone")?.trim() ?? "";
  if (!KEY.test(expert) || !VOICE_LANGUAGES.some((l) => l.id === language)) return null;
  if (voice && !KEY.test(voice)) return null;
  return {
    "X-Yelema-Expert": expert,
    "X-Yelema-Language": language,
    ...(voice ? { "X-Yelema-Voice": voice } : {}),
    ...(TIME_ZONE.test(zone) ? { "X-Yelema-Timezone": zone } : {}),
  };
}

// ---- The member's choice ------------------------------------------------------------------------
// The voice is kept by the back office (`voices` of `/app/me`), so the web app and the mobile app
// share it and an update never loses it. The call language stays a setting of this browser.

export interface VoicePrefs {
  language: VoiceLanguage;
  /** Chosen voice per language; absent: the language's default. */
  voices: Partial<Record<VoiceLanguage, string>>;
}

// One setting per expert (its catalogue key); an expert not set yet takes what was chosen for all
// of them before, in "Mon profil" (the bare key), else French and its default voice.
const PREFS_KEY = "yelema-voice";

export function parseVoicePrefs(raw: string | null): VoicePrefs | null {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<VoicePrefs> | null;
    if (!v || typeof v !== "object") return null;
    return { language: v.language === "en" ? "en" : "fr", voices: v.voices && typeof v.voices === "object" ? v.voices : {} };
  } catch {
    return null;
  }
}

export function readVoicePrefs(expert: string): VoicePrefs {
  try {
    return parseVoicePrefs(localStorage.getItem(`${PREFS_KEY}:${expert}`)) ?? parseVoicePrefs(localStorage.getItem(PREFS_KEY)) ?? { language: "fr", voices: {} };
  } catch {
    return { language: "fr", voices: {} };
  }
}

export function writeVoicePrefs(expert: string, prefs: VoicePrefs): void {
  try {
    localStorage.setItem(`${PREFS_KEY}:${expert}`, JSON.stringify({ language: prefs.language, voices: {} }));
  } catch {}
}

/** Voices kept by the back office: per expert key, `*` for all of them. */
export type ServerVoices = Record<string, Partial<Record<VoiceLanguage, string>>>;

/** The voices that apply to this expert: its own, else those chosen for all. */
export const voicesFor = (server: ServerVoices, expert: string): Partial<Record<VoiceLanguage, string>> => ({ ...(server["*"] ?? {}), ...(server[expert] ?? {}) });

/** `PATCH /api/account { voices }` body for one expert: a voice per language, `null` back to the default. */
export const voicePatch = (expert: string, voices: Partial<Record<VoiceLanguage, string>>): ServerVoices | Record<string, Record<VoiceLanguage, string | null>> => ({
  [expert]: { fr: voices.fr ?? null, en: voices.en ?? null },
});

/** A voice still in this browser from before the back office kept it, to push once; null if none. */
export function legacyVoices(expert: string): Partial<Record<VoiceLanguage, string>> | null {
  try {
    const own = parseVoicePrefs(localStorage.getItem(`${PREFS_KEY}:${expert}`))?.voices ?? {};
    const all = parseVoicePrefs(localStorage.getItem(PREFS_KEY))?.voices ?? {};
    const merged = { ...all, ...own };
    return Object.keys(merged).length ? merged : null;
  } catch {
    return null;
  }
}

// ---- Narrowing the list: gender × country ------------------------------------------------------------

export interface VoiceFilter {
  gender: "female" | "male" | null;
  country: string | null;
}

/** "neutral" voices are often mislabelled at Aethex: they only show under "all genders". */
const fits = (v: VoiceOption, f: VoiceFilter): boolean => (!f.gender || v.gender === f.gender) && (!f.country || v.country === f.country);

export const filterVoices = (voices: VoiceOption[], f: VoiceFilter): VoiceOption[] => voices.filter((v) => fits(v, f));

/** Genders and countries still on offer, each under the other choice, so both rows narrow each other. */
export function voiceFacets(voices: VoiceOption[], f: VoiceFilter): { genders: ("female" | "male")[]; countries: string[] } {
  const genders = new Set(filterVoices(voices, { ...f, gender: null }).map((v) => v.gender));
  const countries = new Set(filterVoices(voices, { ...f, country: null }).map((v) => v.country));
  return {
    genders: (["female", "male"] as const).filter((g) => genders.has(g)),
    countries: [...countries].sort(byCountry),
  };
}

// France first, then the other countries in French order (Leslie, 29/10).
const byCountry = (a: string, b: string): number => Number(a.toUpperCase() !== "FR") - Number(b.toUpperCase() !== "FR") || countryName(a).localeCompare(countryName(b), "fr");

/** The voices by country, France first, then by first name. */
export const sortVoices = (voices: VoiceOption[]): VoiceOption[] => [...voices].sort((a, b) => byCountry(a.country, b.country) || a.label.localeCompare(b.label, "fr"));

const REGIONS = new Intl.DisplayNames(["fr"], { type: "region" });
export const countryName = (code: string): string => REGIONS.of(code) ?? code;
export const countryFlag = (code: string): string => String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));

// The French voices Aethex added for Yelema on 20/10, spread across the Experts so they do not all
// speak alike: a woman's voice for an Experte, a man's for an Expert (Leslie, 21/10). Louise is left
// out (a noise in its first seconds). Matched on the name the voice list gives.
const SPREAD: Record<"elle" | "il", string[]> = { elle: ["Adèle", "Emma", "Céline"], il: ["Léo", "Raphaël", "Clément"] };
const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** The voice an Expert takes by default in French: always the same one for the same Expert; null when unknown. */
export type VoiceExpert = { key: string; pronoun: "elle" | "il" | null; /** Its place among the catalogue's Experts of the same gender: they take the voices in turn. */ rank?: number };

export function expertDefaultVoice(voices: VoiceOption[], language: VoiceLanguage, expert?: VoiceExpert): VoiceOption | null {
  if (language !== "fr" || !expert?.pronoun) return null;
  const pool = SPREAD[expert.pronoun].flatMap((name) => voices.filter((v) => v.language === "fr" && plain(v.label) === plain(name)).slice(0, 1));
  if (!pool.length) return null;
  let h = expert.rank ?? 0;
  if (expert.rank === undefined) for (const c of expert.key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}

/** The voice a call takes: the one chosen for the language, else the Expert's own default, else the language's, else its first. */
export function chosenVoice(voices: VoiceOption[], prefs: VoicePrefs, expert?: VoiceExpert): VoiceOption | null {
  const ofLanguage = voices.filter((v) => v.language === prefs.language);
  return (
    ofLanguage.find((v) => v.key === prefs.voices[prefs.language]) ??
    expertDefaultVoice(voices, prefs.language, expert) ??
    ofLanguage.find((v) => v.default) ??
    ofLanguage[0] ??
    null
  );
}

// ---- Call history -----------------------------------------------------------------------------------

export interface CallRecord {
  /** The call's session id. */
  id: string;
  expert: string;
  language: VoiceLanguage;
  status: "open" | "ended" | "failed";
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  /** Written by the expert once the call is over, from the exact transcript it was handed. */
  subject: string | null;
  /** 3 to 5 short lines: asked, decided or done, still to do. Empty until written. */
  summary: string[];
  /** Just ended: the expert is probably still writing its subject and summary. */
  subjectPending: boolean;
  /**
   * The call's lines, for the « Transcription » tab, once the back office serves them (it does not
   * yet). Only a transcript the back office chose to serve: the raw one handed to the expert in its
   * session is full of recognition errors and is never dug out of the chat.
   */
  transcript?: TranscriptLine[] | null;
  /** The summary in three sections, once the back office serves them (it does not yet). */
  keyPoints?: string[] | null;
  decisions?: string[] | null;
  nextSteps?: string[] | null;
}

export interface TranscriptLine {
  who: "user" | "expert";
  text: string;
  /** Seconds from the start of the call, when the back office gives it. */
  at?: number;
}

const lines = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);

/** The summary's sections when the back office serves them; null to show the summary as one block. */
export function summarySections(r: Pick<CallRecord, "keyPoints" | "decisions" | "nextSteps">): { title: string; items: string[] }[] | null {
  const out = [
    { title: "Points clés", items: lines(r.keyPoints) },
    { title: "Décisions", items: lines(r.decisions) },
    { title: "Prochaines étapes", items: lines(r.nextSteps) },
  ].filter((x) => x.items.length);
  return out.length ? out : null;
}

/** The well-formed lines of a call's transcript; empty when the back office sent none. */
export function transcriptOf(record: Pick<CallRecord, "transcript">): TranscriptLine[] {
  const lines = Array.isArray(record.transcript) ? record.transcript : [];
  return lines
    .filter((l): l is TranscriptLine => !!l && (l.who === "user" || l.who === "expert") && typeof l.text === "string" && l.text.trim() !== "")
    .map((l) => ({ who: l.who, text: frenchSpacing(l.text), ...(typeof l.at === "number" && Number.isFinite(l.at) && l.at >= 0 ? { at: l.at } : {}) }));
}

// The back office hands the expert the call's exact transcript in the call's session. It is full of
// transcription errors: the chat shows that it was handed over, never the text. Prefix set by the back office.
const CALL_TRANSCRIPT = /^(Transcription exacte de l'appel vocal|Exact transcript of the voice call) /;
export const isCallTranscript = (content: string): boolean => CALL_TRANSCRIPT.test(content);

/** "3 min 16 s", "45 s". */
export function callDuration(seconds: number | null): string {
  if (seconds == null) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m} min${s ? ` ${s} s` : ""}` : `${s} s`;
}

/**
 * Where `query` appears in `text`, ignoring case and accents (« reunion » finds « Réunion »), as
 * [start, end) ranges of `text`; empty for an empty query. Searches the « Transcription » of a call.
 */
export function findInText(text: string, query: string): [number, number][] {
  // Non-breaking spaces (French typography) count as spaces: « 5 % » finds « 5\u00a0% ».
  const fold = (c: string) => (c === "\u00a0" || c === "\u202f" ? " " : c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase());
  const q = [...query.trim()].map(fold).join("");
  if (!q) return [];
  // Folded text, with where each folded character came from.
  let folded = "";
  const from: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) from.push(i);
    folded += f;
    i += ch.length;
  }
  from.push(text.length);
  const out: [number, number][] = [];
  for (let at = folded.indexOf(q); at !== -1; at = folded.indexOf(q, at + q.length)) {
    const end = from[at + q.length - 1];
    out.push([from[at], end + [...text.slice(end)][0].length]);
  }
  return out;
}

/**
 * French typography for text shown as is (a transcript, a summary): the space before % : ; ? ! »
 * and after « becomes non-breaking, so « 5 % » never leaves « % » alone on the next line.
 */
export function frenchSpacing(text: string): string {
  return text.replace(/ ([%:;?!»])/g, "\u00a0$1").replace(/« /g, "«\u00a0");
}

/**
 * A call's account as plain text, to share it (e-mail, WhatsApp, copy, a .txt file): title and date,
 * the summary (its sections, else its lines), then the transcript when the back office serves one.
 */
export function callShareText(
  c: Pick<CallRecord, "summary" | "keyPoints" | "decisions" | "nextSteps" | "transcript">,
  { title, meta, expertName, memberName }: { title: string; meta: string; expertName: string; memberName: string }
): string {
  const out = [`Appel avec ${expertName} : ${title}`, meta, ""];
  const sections = summarySections(c);
  if (sections) for (const s of sections) out.push(s.title, ...s.items.map((i) => `- ${i}`), "");
  else if (lines(c.summary).length) out.push("Résumé", ...lines(c.summary).map((i) => `- ${i}`), "");
  const said = transcriptOf(c);
  if (said.length) out.push("Transcription", ...said.map((l) => `${l.who === "expert" ? expertName : memberName} : ${l.text}`), "");
  return out.join("\n").trim() + "\n";
}
