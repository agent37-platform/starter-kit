// « Cette nuit » : ce que chaque Expert a fait, n'a pas pu faire ou n'a pas commencé depuis la veille au soir
// (Leslie, 20/11 : « le matin tu es déçue car il n'a rien fait »). Deux sources : les tâches du tableau de l'Expert
// (image Hermes I79, `GET /p/<expert>/api/taches`) et ses routines (dernier et prochain passage). No imports, for `node --test`.

export type NightState = "fait" | "bloque" | "en-cours" | "pas-parti";

export interface NightTask {
  id: string;
  titre: string;
  statut: string;
  creee: number | null;
  debut: number | null;
  fin: number | null;
  resume: string | null;
  blocage: string | null;
  conversation: string | null;
}

export interface NightRoutine {
  id: string;
  name: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface NightItem {
  id: string;
  kind: "tache" | "routine";
  title: string;
  state: NightState;
  /** Pourquoi c'est bloqué, ou ce qui a été rendu, en une ligne. */
  detail: string | null;
  /** Epoch ms : la fin, le blocage, le passage ou l'heure prévue. */
  at: number | null;
  /** La conversation où lire la suite. */
  session: string | null;
}

// The night starts the evening before at 18:00 (Abidjan is on UTC all year, as the instances are); after 18:00 it is tonight's.
export function nightStart(now: number): number {
  const d = new Date(now);
  const evening = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 18);
  return now >= evening ? evening : evening - 86_400_000;
}

const ms = (s: number | null) => (s ? (s < 1e12 ? s * 1000 : s) : null);
const parse = (iso: string | null) => (iso && !Number.isNaN(Date.parse(iso)) ? Date.parse(iso) : null);
const line = (t: string | null) => (t ?? "").replace(/\s+/g, " ").trim().slice(0, 220) || null;
// A run still « due » this long after its hour did not start (the platform wakes the instance 2 min before).
const LATE_MS = 15 * 60_000;

const TASK_STATE: Record<string, NightState> = {
  done: "fait",
  review: "fait",
  blocked: "bloque",
  running: "en-cours",
  ready: "en-cours",
  todo: "en-cours",
  triage: "en-cours",
  scheduled: "en-cours",
};

/** One Expert's night, newest first: the tasks touched since `nightStart`, the routines that ran or should have. */
export function nightOf(tasks: NightTask[], routines: NightRoutine[], now: number): NightItem[] {
  const since = nightStart(now);
  const items: NightItem[] = [];
  for (const t of tasks) {
    const state = TASK_STATE[t.statut];
    const at = ms(t.fin) ?? ms(t.debut) ?? ms(t.creee);
    if (!state || !at || Math.max(at, ms(t.creee) ?? 0) < since) continue;
    items.push({ id: t.id, kind: "tache", title: t.titre, state, detail: state === "bloque" ? line(t.blocage) ?? "Raison non donnée." : state === "fait" ? line(t.resume) : null, at, session: t.conversation });
  }
  for (const r of routines) {
    if (!r.enabled) continue;
    const last = parse(r.lastRunAt);
    const next = parse(r.nextRunAt);
    if (last && last >= since) items.push({ id: r.id, kind: "routine", title: r.name, state: "fait", detail: null, at: last, session: null });
    else if (next && next >= since && next < now - LATE_MS) items.push({ id: r.id, kind: "routine", title: r.name, state: "pas-parti", detail: null, at: next, session: null });
  }
  return items.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

export type NightCounts = Record<NightState, number>;

export function nightCounts(items: NightItem[]): NightCounts {
  const c: NightCounts = { fait: 0, bloque: 0, "en-cours": 0, "pas-parti": 0 };
  for (const i of items) c[i.state] += 1;
  return c;
}

/** « 4 faits, 1 bloqué, 1 pas parti » : what the strip says, nothing when nothing happened. */
export function nightSummary(c: NightCounts): string {
  const part = (n: number, one: string, many: string) => (n ? `${n} ${n > 1 ? many : one}` : null);
  return [part(c.fait, "fait", "faits"), part(c.bloque, "bloqué", "bloqués"), part(c["pas-parti"], "pas parti", "pas partis"), part(c["en-cours"], "en cours", "en cours")]
    .filter(Boolean)
    .join(", ");
}
