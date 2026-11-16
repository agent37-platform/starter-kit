// Découpage d'une période en UTC : aujourd'hui heure par heure ; 7, 30 ou 90 jours par jour, semaine
// (du lundi) ou mois.

import type { AnalyticsPeriod, Granularity } from "./types.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Nombre de jours, aujourd'hui compris, de chaque période en jours. */
export const PERIOD_DAYS: Record<Exclude<AnalyticsPeriod, "aujourdhui">, number> = { "7_jours": 7, "30_jours": 30, "90_jours": 90 };

export interface PeriodBucket {
  /** `AAAA-MM-JJTHH` pour une heure, `AAAA-MM-JJ` pour un jour ou une semaine, `AAAA-MM` pour un mois. */
  key: string;
  label: string;
  start: number;
  /** Début de la tranche suivante. */
  end: number;
}

export interface PeriodWindow {
  period: AnalyticsPeriod;
  from: number;
  to: number;
  /** Premier et dernier jour UTC de la période. */
  fromDay: string;
  toDay: string;
  buckets: PeriodBucket[];
  /** Tranche de la période qui contient le créneau d'une ligne. */
  bucketOf(slot: string): string;
}

/** Jour UTC `AAAA-MM-JJ` d'un instant en ms. */
export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Heure UTC `AAAA-MM-JJTHH` d'un instant en ms. */
export const isoHour = (ms: number) => new Date(ms).toISOString().slice(0, 13);
const label = (ms: number, options: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleDateString("fr-FR", { ...options, timeZone: "UTC" });

interface Step {
  startOf(dayMs: number): number;
  next(startMs: number): number;
  key(startMs: number): string;
  label(startMs: number, days: number): string;
}

const STEPS: Record<Granularity, Step> = {
  jour: {
    startOf: (d) => d,
    next: (s) => s + DAY_MS,
    key: isoDay,
    label: (s, days) => label(s, days <= 7 ? { weekday: "short", day: "numeric" } : { day: "numeric", month: "short" }),
  },
  semaine: {
    startOf: (d) => d - ((new Date(d).getUTCDay() + 6) % 7) * DAY_MS,
    next: (s) => s + 7 * DAY_MS,
    key: isoDay,
    label: (s) => `Sem. du ${label(s, { day: "numeric", month: "short" })}`,
  },
  mois: {
    startOf: (d) => Date.UTC(new Date(d).getUTCFullYear(), new Date(d).getUTCMonth(), 1),
    next: (s) => Date.UTC(new Date(s).getUTCFullYear(), new Date(s).getUTCMonth() + 1, 1),
    key: (s) => isoDay(s).slice(0, 7),
    label: (s) => label(s, { month: "short", year: "numeric" }),
  },
};

/** Aujourd'hui heure par heure ; un créneau sans heure n'appartient à aucune tranche. */
function todayWindow(now: number): PeriodWindow {
  const today = Date.parse(`${isoDay(now)}T00:00:00Z`);
  const buckets = Array.from({ length: 24 }, (_, h) => {
    const start = today + h * HOUR_MS;
    return { key: isoHour(start), label: `${String(h).padStart(2, "0")}h`, start, end: start + HOUR_MS };
  });
  return { period: "aujourdhui", from: today, to: now, fromDay: isoDay(today), toDay: isoDay(today), buckets, bucketOf: (slot) => slot.slice(0, 13) };
}

/** `granularity` ne s'applique qu'aux périodes en jours ; aujourd'hui est toujours découpé par heure. */
export function periodWindow(period: AnalyticsPeriod, now: number, granularity: Granularity = "jour"): PeriodWindow {
  if (period === "aujourdhui") return todayWindow(now);
  const days = PERIOD_DAYS[period];
  const today = Date.parse(`${isoDay(now)}T00:00:00Z`);
  const first = today - (days - 1) * DAY_MS;
  const step = STEPS[granularity];
  const buckets: PeriodBucket[] = [];
  for (let start = step.startOf(first); start <= today; start = step.next(start)) {
    buckets.push({ key: step.key(start), label: step.label(start, days), start, end: step.next(start) });
  }
  return {
    period,
    from: first,
    to: now,
    fromDay: isoDay(first),
    toDay: isoDay(today),
    buckets,
    bucketOf: (slot) => step.key(step.startOf(Date.parse(`${slot.slice(0, 10)}T00:00:00Z`))),
  };
}

/** Indique si un jour UTC, ou le jour d'une heure, est dans la période. */
export function inWindow(w: PeriodWindow, dayOrHour: string): boolean {
  const day = dayOrHour.slice(0, 10);
  return day >= w.fromDay && day <= w.toDay;
}
