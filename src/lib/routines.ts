// An expert's routines: tasks it runs on its own on a schedule, kept by Hermes's own scheduler in the
// expert's profile (lib/hermes-cron reaches it). Shared by the BFF and the Routines tab: no imports.

export interface Routine {
  id: string;
  name: string;
  // What the expert is asked to do, as written (without the skills and file lines below).
  task: string;
  // One line for the list.
  summary: string;
  skills: string[];
  attachment: string | null;
  // Hermes's schedule: a five-field cron expression, or an ISO date-time for a one-off.
  schedule: string;
  enabled: boolean;
  // Shipped with the expert and never turned on: shown under "Proposées par …".
  suggested: boolean;
  // ISO date-times from Hermes; null before the first run, or while paused for the next one.
  lastRunAt: string | null;
  nextRunAt: string | null;
  /** Where Hermes sends the result: « telegram:…,local », « local », « origin », or null. */
  deliver?: string | null;
}

// The time zone schedules are read in. The instances run on UTC, which is Abidjan's time all year.
export const ROUTINE_TIMEZONE = "Africa/Abidjan";

// The skills and the attached file ride at the end of the prompt, in lines the form can read back.
const SKILLS_HEADER = "Compétences à mobiliser :";
const FILE_PREFIX = "Fichier joint : ";

export function composePrompt(task: string, skills: string[], attachment: string | null): string {
  return [
    task.trim(),
    skills.length ? [SKILLS_HEADER, ...skills.map((s) => `- ${s}`)].join("\n") : "",
    attachment ? `${FILE_PREFIX}${attachment}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function splitPrompt(prompt: string): { task: string; skills: string[]; attachment: string | null } {
  const blocks = prompt.trim().split(/\n{2,}/);
  let attachment: string | null = null;
  let skills: string[] = [];
  if (blocks.length > 1 && blocks[blocks.length - 1].startsWith(FILE_PREFIX)) {
    attachment = blocks.pop()!.slice(FILE_PREFIX.length).trim() || null;
  }
  if (blocks.length > 1 && blocks[blocks.length - 1].startsWith(SKILLS_HEADER)) {
    skills = blocks
      .pop()!
      .split("\n")
      .slice(1)
      .map((line) => line.replace(/^- /, "").trim())
      .filter(Boolean);
  }
  return { task: blocks.join("\n\n"), skills, attachment };
}

// The list's line: the first sentence of the task, without the "Tu es Mamadou." the experts' own
// routines open with (their text is wrapped, so a paragraph's lines are joined first).
export function summarize(task: string): string {
  const text = task.replace(/^Tu es [^.\n]+\.\s*/, "").trim();
  const paragraph = text.split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, " ");
  const line = paragraph.replace(/^[-*\d.\s]+/, "").replace(/\*\*/g, "");
  const sentence = line.match(/^.+?[.!?](\s|$)/)?.[0].trim() ?? line;
  return sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence;
}

// A name from the task when none is given: its first clause, cut at a word.
export function nameFrom(task: string): string {
  const clause = task.trim().split(/[.,;:\n]/)[0].trim();
  if (clause.length <= 50) return clause;
  const cut = clause.slice(0, 50);
  return cut.slice(0, cut.lastIndexOf(" ") > 20 ? cut.lastIndexOf(" ") : 50);
}

// ---- Runs ----

// A routine's run opens with Hermes's own instructions to the expert (cron/scheduler_prompt.py),
// after any skill it loads, before the routine's text.
const RUN_PREAMBLE = "[IMPORTANT: You are running as a scheduled cron job.";

export function isRoutineRun(content: string): boolean {
  return content.includes(RUN_PREAMBLE);
}

// The routine's own instructions, without Hermes's preamble nor the skills loaded before it.
export function routineRunText(content: string): string {
  const start = content.indexOf(RUN_PREAMBLE);
  if (start < 0) return content;
  const end = content.indexOf("]\n\n", start);
  return end < 0 ? content : content.slice(end + 3).trim();
}

// What a run was asked, for the member to read: the routine's task in plain words. Commands, paths,
// file names and Hermes's markers stay out (Leslie, 28/10: « évite les trucs genre python »); null
// when nothing plain is left.
const TECHNICAL = /`|\bpython|\.(py|json|sh|md|ya?ml)\b|\/home\/|~\/|\[?\b(SILENT|NO_REPLY|CRON_FAILURE)\b\]?|https?:\/\/|\{|\}/i;
// One sentence: the routine's own line, not the steps it goes through.
const MAX_SENTENCES = 1;

export function routinePlainText(content: string): string | null {
  const { task } = splitPrompt(routineRunText(content));
  const sentences = task
    .replace(/^Tu es [^.\n]+\.\s*/, "")
    .replace(/\*\*/g, "")
    .split(/\n+/)
    .flatMap((line) => line.replace(/^[-*\d.)\s]+/, "").split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 2 && !TECHNICAL.test(s));
  return sentences.length ? sentences.slice(0, MAX_SENTENCES).join(" ") : null;
}

// A run with nothing to report answers [SILENT] (or SILENT / NO_REPLY), alone or on its first or last
// line: Hermes's own rule (gateway/response_filters.py), which then sends nothing.
const SILENT_LINE = /^\[?(SILENT|NO[_ ]REPLY)\]?[.!]?$/i;

export function isSilentRun(answer: string): boolean {
  const text = answer.trim();
  if (!text) return false;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return text.toUpperCase().startsWith("[SILENT]") || [text, lines[0], lines[lines.length - 1]].some((l) => SILENT_LINE.test(l));
}

export const SILENT_RUN_LABEL = "Rien à signaler : la routine n’a rien envoyé.";

// Hermes names a run's conversation "<routine name> · Oct 16 09:00" and its id "cron_<routine>_<time>".
const RUN_TITLE_DATE = / · [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}( #\d+)?$/;

export interface SessionHint {
  id: string;
  title?: string | null;
  preview?: string | null;
}

// The routine a conversation is a run of, by name, or null for a conversation a person started.
export function routineOfSession({ id, title, preview }: SessionHint): string | null {
  const t = (title ?? "").trim();
  // Hermes may also title a run with its own preamble, the preview then starting with a skill it loaded.
  if (!id.startsWith("cron_") && !isRoutineRun(preview ?? "") && !t.startsWith("[IMPORTANT: You are running as a scheduled cron job") && !(RUN_TITLE_DATE.test(t) && (preview ?? "").startsWith("[IMPORTANT:"))) {
    return null;
  }
  return (t.startsWith("[IMPORTANT:") ? "" : t.replace(RUN_TITLE_DATE, "").trim()) || "Routine";
}

// A memory routine works for the expert alone (« Routine de mémoire, silencieuse »): its runs are never
// a conversation nor a notification, whatever they answer (Leslie, 29/10).
const MEMORY_NAME = /^m[ée]moire\b/i;
const MEMORY_TASK = /routine de m[ée]moire/i;

export function isMemoryRun(session: SessionHint): boolean {
  const routine = routineOfSession(session);
  if (routine === null) return false;
  return MEMORY_NAME.test(routine) || MEMORY_TASK.test(session.preview ?? "") || MEMORY_TASK.test(session.title ?? "");
}

export function isMemoryRoutine(r: Pick<Routine, "name" | "task">): boolean {
  return MEMORY_NAME.test(r.name.trim()) || MEMORY_TASK.test(r.task);
}

// Whether a past run opens as a conversation: only one that delivered something, and never a memory
// routine's (Leslie, 30/10: « rien à signaler » is a line in the history, not a page).
export function runOpens(run: Pick<RoutineRun, "outcome">, routine: Pick<Routine, "name" | "task">): boolean {
  return run.outcome === "sent" && !isMemoryRoutine(routine);
}

// Whether a conversation is one of THIS routine's runs: its id, else its title (name cut as Hermes does).
export function isRunOf(session: SessionHint, routine: { id: string; hermesName: string }): boolean {
  if (session.id.startsWith(`cron_${routine.id}_`)) return true;
  const base = routine.hermesName.split(/\s+/).join(" ").slice(0, 60).trim();
  return !!base && routineOfSession(session) !== null && (session.title ?? "").startsWith(`${base} · `);
}

export type RunOutcome = "sent" | "silent" | "failed";

export interface RoutineRun {
  sessionId: string;
  /** Epoch milliseconds. */
  at: number;
  /** null when the conversation could not be read. */
  outcome: RunOutcome | null;
}

// What a run came to, from its last answer: none or [CRON_FAILURE] is a failure.
export function runOutcome(lastAnswer: string | null): RunOutcome {
  if (!lastAnswer?.trim() || lastAnswer.trim().startsWith("[CRON_FAILURE]")) return "failed";
  return isSilentRun(lastAnswer) ? "silent" : "sent";
}

// ---- Schedules ----

const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

const pad = (n: string | number) => String(n).padStart(2, "0");

export function isOneOff(schedule: string): boolean {
  return schedule.includes("T");
}

export interface Recurrence {
  label: string;
  dom: string; // day of the month
  dow: string; // day of the week
}

// The choices of the form's "Récurrent" list.
export const RECURRENCES: Recurrence[] = [
  { label: "Chaque jour", dom: "*", dow: "*" },
  { label: "Chaque jour ouvré", dom: "*", dow: "1-5" },
  ...[1, 2, 3, 4, 5, 6, 0].map((d) => ({ label: `Chaque ${DAYS[d]}`, dom: "*", dow: String(d) })),
  { label: "Le 1er du mois", dom: "1", dow: "*" },
];

// Days part of a cron expression in words ("Chaque lundi et jeudi"), or null when it has none.
function recurrenceLabel(dom: string, dow: string): string | null {
  const preset = RECURRENCES.find((r) => r.dom === dom && r.dow === dow);
  if (preset) return preset.label;
  if (dom === "*" && dow === "1-6") return "Du lundi au samedi";
  if (dom === "*" && /^[0-7](,[0-7])+$/.test(dow)) {
    const names = dow.split(",").map((d) => DAYS[Number(d) % 7]);
    return `Chaque ${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
  }
  if (/^\d{1,2}$/.test(dom) && dow === "*") return `Le ${dom} du mois`;
  return null;
}

export interface CronParts {
  dom: string;
  dow: string;
  time: string; // "09:30"
}

// The parts the form edits, or null for an expression it can't show (steps, months, ranges of hours).
export function cronParts(schedule: string): CronParts | null {
  const f = schedule.trim().split(/\s+/);
  if (f.length !== 5 || !/^\d{1,2}$/.test(f[0]) || !/^\d{1,2}$/.test(f[1]) || f[3] !== "*") return null;
  if (!recurrenceLabel(f[2], f[4])) return null;
  return { dom: f[2], dow: f[4], time: `${pad(f[1])}:${pad(f[0])}` };
}

export function cronFor({ dom, dow, time }: CronParts): string {
  const [h, m] = time.split(":").map(Number);
  return `${m} ${h} ${dom} * ${dow}`;
}

// "2026-10-06" + "09:00" → the one-off's ISO date-time, in the routines' time zone (UTC).
export function oneOffFor(date: string, time: string): string {
  return `${date}T${time}:00+00:00`;
}

export function recurrenceOf(parts: CronParts): string {
  return recurrenceLabel(parts.dom, parts.dow) ?? "";
}

// "07:30" → "7 h 30", "17:00" → "17 h": as a French reader says it (Leslie, 30/10), with no-break
// spaces so a narrow row never splits « 7 h » from « 30 ».
export function frTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return m ? `${h}\u00a0h\u00a0${pad(String(m))}` : `${h}\u00a0h`;
}

// « 17 7-21 * * * », the memory routines' hourly runs, read « Toutes les heures de 7 h à 21 h »
// rather than « Horaire : 17 7-21 * * * ».
function hourlyLabel(f: string[]): string | null {
  if (!/^\d{1,2}$/.test(f[0]) || f[2] !== "*" || f[3] !== "*" || !["*", "1-5"].includes(f[4])) return null;
  const days = f[4] === "1-5" ? ", du lundi au vendredi" : "";
  const range = /^(\d{1,2})-(\d{1,2})$/.exec(f[1]);
  if (range) return `Toutes les heures de ${frTime(range[1])} à ${frTime(range[2])}${days}`;
  const step = /^\*\/(\d{1,2})$/.exec(f[1]);
  if (step) return `Toutes les ${step[1]} heures${days}`;
  if (f[1] === "*") return `Toutes les heures${days}`;
  return null;
}

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} et ${xs[xs.length - 1]}` : xs[0]);
const dayNum = (d: string) => (Number(d) === 1 ? "1er" : String(Number(d)));

// Any other expression with a fixed hour, read in words rather than shown raw (Leslie, 06/11:
// « Horaire : 45 8 2 1,4,7,10 * »): days of the month and months as lists, days of the week as a
// list or a range. « Le 2 janvier, avril, juillet et octobre à 8 h 45 ». Null when it is not one.
function fixedTimeLabel(f: string[]): string | null {
  if (!/^\d{1,2}$/.test(f[0]) || !/^\d{1,2}$/.test(f[1])) return null;
  const [, , dom, mon, dow] = f;
  const list = /^\d{1,2}(,\d{1,2})*$/;
  if ((dom !== "*" && !list.test(dom)) || (mon !== "*" && !list.test(mon))) return null;
  const months = mon === "*" ? null : mon.split(",").map((m) => MONTHS[Number(m) - 1]);
  if (months?.some((m) => !m)) return null;
  let days: string | null = null;
  if (dow !== "*") {
    const range = /^([0-7])-([0-7])$/.exec(dow);
    if (range) days = `du ${DAYS[Number(range[1]) % 7]} au ${DAYS[Number(range[2]) % 7]}`;
    else if (/^[0-7](,[0-7])*$/.test(dow)) days = `le ${andList(dow.split(",").map((d) => DAYS[Number(d) % 7]))}`;
    else return null;
  }
  const at = `à ${frTime(`${f[1]}:${f[0]}`)}`;
  if (dom !== "*") {
    const dates = dom.split(",").map(dayNum);
    const head = dates.length > 1 ? `Les ${andList(dates)}` : `Le ${dates[0]}`;
    return `${head} ${months ? andList(months) : "du mois"}${days ? `, ${days}` : ""} ${at}`;
  }
  if (months) return `${days ? `Chaque semaine ${days}` : "Chaque jour"} en ${andList(months)} ${at}`;
  return days ? `Chaque semaine ${days} ${at}` : null;
}

// "Chaque lundi à 7 h 30", "Le 6 octobre à 9 h, une fois".
export function scheduleLabel(schedule: string): string {
  if (isOneOff(schedule)) {
    const d = new Date(schedule);
    if (Number.isNaN(d.getTime())) return schedule;
    const day = d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
    return `Le ${day} à ${frTime(`${d.getUTCHours()}:${d.getUTCMinutes()}`)}, une fois`;
  }
  const parts = cronParts(schedule);
  if (parts) return `${recurrenceOf(parts)} à ${frTime(parts.time)}`;
  const f = schedule.trim().split(/\s+/);
  return (f.length === 5 && (hourlyLabel(f) ?? fixedTimeLabel(f))) || `Horaire : ${schedule}`;
}

// A run's day and hour, in words and in the routines' time zone (UTC): « aujourd’hui à 17 h »,
// « demain à 7 h 30 », « hier à 8 h », « lundi à 7 h 30 », « le 12 novembre à 9 h ».
export function runDayLabel(at: number, now = Date.now()): string {
  const d = new Date(at);
  const n = new Date(now);
  const time = frTime(`${d.getUTCHours()}:${d.getUTCMinutes()}`);
  const days = Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())) / 86_400_000);
  if (days === 0) return `aujourd’hui à ${time}`;
  if (days === 1) return `demain à ${time}`;
  if (days === -1) return `hier à ${time}`;
  if (Math.abs(days) < 7) return `${d.toLocaleDateString("fr-FR", { weekday: "long", timeZone: "UTC" })}${days < 0 ? " dernier" : ""} à ${time}`;
  return `le ${d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" })} à ${time}`;
}
export const nextRunLabel = runDayLabel;

/**
 * The chip beside a routine's schedule. A next run already past (an instance that slept: no routine
 * runs then) never reads « Prochaine : lundi dernier » (Leslie, 01/11): it says the run has not left yet.
 */
export function nextRunChip(nextRunAt: number, now = Date.now()): string {
  if (nextRunAt < now - 60_000) return `Pas encore partie, prévue ${runDayLabel(nextRunAt, now)}`;
  return `Prochaine : ${runDayLabel(nextRunAt, now)}`;
}

const PLATFORMS: Record<string, string> = { telegram: "Telegram", slack: "Slack", teams: "Teams", whatsapp: "WhatsApp", discord: "Discord", email: "e-mail", local: "l’app" };

// Where a routine's result arrives (PDF du 30/10 : « canal de réception »). The app always shows a run
// that delivered; « origin » or nothing is a routine an Expert set up from a chat: its result is in the
// app only. Said calmly, with a way to receive it elsewhere too, never as an alert (Leslie, 01/11).
export function deliveryLabel(deliver: string | null | undefined): { text: string; ok: boolean } {
  const targets = (deliver ?? "").split(",").map((t) => t.trim().split(":")[0].toLowerCase()).filter(Boolean);
  if (!targets.length || targets.every((t) => t === "origin")) return { text: "Reçue dans l’app", ok: false };
  const names = [...new Set(["l’app", ...targets.filter((t) => t !== "origin").map((t) => PLATFORMS[t] ?? t)])];
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}` : names[0];
  return { text: `Reçue dans ${list}`, ok: true };
}

// Today, or a day ahead, as "YYYY-MM-DD" (the form's date field).
export function todayIso(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

// Upkeep: the routines an expert runs on itself (memory, the morning prep, the evening tidy-up, its connections, its
// own review) or that only sync a form to a sheet. They send nothing when all is well and open no
// conversation, so the Routines tab folds them under « Entretien », below the work (Leslie, 29/10).
const UPKEEP = [
  /^routine de mémoire\b/i,
  /\bprépare ta journée en silence\b/i,
  /\brange ta journée sans écrire\b/i,
  /\brévise ta mémoire\b/i,
  /\bbalaie tes connexions\b/i,
  /^synchronise\b/i,
];
const UPKEEP_NAME = /^(m[ée]moire\b|r[ée]vision (de la )?m[ée]moire|relecture de moi|pr[ée]paration du matin|rangement du soir|balayage des connexions)|\bsynchro\b/i;

export function isUpkeep(r: Pick<Routine, "name" | "task">): boolean {
  if (UPKEEP_NAME.test(r.name.trim())) return true;
  const task = r.task.replace(/^Tu es [^.\n]+\.\s*/, "").trim();
  return UPKEEP.some((re) => re.test(task));
}
