// Les calculs de l'activité des experts, à partir de leurs sessions. Pas de texte ici.
import type { DiscoveredExpert, RawSessionInfo } from "../types.ts";

/** L'heure d'une session en millisecondes : sa dernière activité, sinon son début (secondes converties), sinon 0. */
export function sessionTime(s: RawSessionInfo): number {
  const raw = typeof s.last_active === "number" ? s.last_active : typeof s.started_at === "number" ? s.started_at : 0;
  return raw < 1e11 ? raw * 1000 : raw;
}

export interface ExpertActivity {
  expert: DiscoveredExpert;
  count: number;
  lastActive: number;
}

/**
 * Les experts actifs depuis `cutoff` (le plus récent d'abord) et les inactifs. Les experts installés,
 * plus ceux qu'on ne connaît que par leurs sessions.
 */
export function activityByExpert(
  sessions: RawSessionInfo[],
  cutoff: number,
  experts?: DiscoveredExpert[]
): { actifs: ExpertActivity[]; inactifs: DiscoveredExpert[] } {
  const expertMap = new Map<string, DiscoveredExpert>();
  for (const exp of experts ?? []) expertMap.set(exp.id.toLowerCase(), exp);
  for (const s of sessions) {
    const p = (s.profile || "").toLowerCase();
    if (p && !expertMap.has(p)) expertMap.set(p, { id: p, name: p.charAt(0).toUpperCase() + p.slice(1), description: "" });
  }

  const actifs: ExpertActivity[] = [];
  const inactifs: DiscoveredExpert[] = [];
  for (const exp of expertMap.values()) {
    const matching = sessions.filter((s) => {
      const profile = (s.profile || "").toLowerCase();
      return (profile === exp.id || s.id.includes(`_${exp.id}_`)) && sessionTime(s) >= cutoff;
    });
    if (matching.length > 0) {
      actifs.push({ expert: exp, count: matching.length, lastActive: Math.max(...matching.map(sessionTime)) });
    } else {
      inactifs.push(exp);
    }
  }
  actifs.sort((a, b) => b.lastActive - a.lastActive);
  return { actifs, inactifs };
}

/** Le nombre de sessions de chaque profil, le plus sollicité d'abord. */
export function sessionsPerProfile(sessions: RawSessionInfo[]): Array<[string, number]> {
  const counts: Record<string, number> = {};
  for (const s of sessions) {
    const p = (s.profile || "").toLowerCase();
    if (p) counts[p] = (counts[p] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
