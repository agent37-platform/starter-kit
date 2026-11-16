// Les dates et les périodes (aujourd'hui, 7 jours, 30 jours) des réponses de Yélé.

import { addUsage, emptyUsage } from "./session-usage/usage.ts";
import type { ExpertUsageData, UsageByDay } from "./types.ts";

export const DAY_MS = 24 * 3600 * 1000;

export function formatDateFr(ms: number): string {
  return new Date(ms).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getPeriodCutoff(periode?: string, now = Date.now()): number {
  if (periode === "7_jours") return now - 7 * 24 * 3600 * 1000;
  if (periode === "30_jours") return now - 30 * 24 * 3600 * 1000;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The UTC days a period covers, as the back office counts them: today, or the last 7 / 30 days with today. */
export function periodDays(periode?: string, now = Date.now()): { from: string; to: string; label: string } {
  const span = periode === "7_jours" ? 7 : periode === "30_jours" ? 30 : 1;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const label = span === 1 ? "aujourd'hui (UTC)" : `les ${span} derniers jours (UTC)`;
  return { from: iso(now - (span - 1) * DAY_MS), to: iso(now), label };
}

/** Usage per expert over a period, summed from the days it covers. */
export function usageForPeriod(byDay: UsageByDay, periode?: string, now = Date.now()): Record<string, ExpertUsageData> {
  const { from, to } = periodDays(periode, now);
  const out: Record<string, ExpertUsageData> = {};
  for (const [day, perExpert] of Object.entries(byDay)) {
    if (day < from || day > to) continue;
    for (const [exp, u] of Object.entries(perExpert)) addUsage((out[exp] ??= emptyUsage()), u);
  }
  return out;
}
