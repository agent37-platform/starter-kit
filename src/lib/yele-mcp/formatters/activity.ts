// L'activité des experts, mise en texte. Les calculs sont dans ../summaries/activity.ts.

import { formatExpertDisplayName } from "../experts.ts";
import { formatDateFr, getPeriodCutoff } from "../periods.ts";
import { activityByExpert, sessionsPerProfile } from "../summaries/activity.ts";
import type { DiscoveredExpert, RawSessionInfo } from "../types.ts";

export function formatActiviteExperts(
  sessions: RawSessionInfo[],
  periode?: string,
  experts?: DiscoveredExpert[],
  now = Date.now()
): string {
  const periodeLabel =
    periode === "7_jours" ? "ces 7 derniers jours" : periode === "30_jours" ? "ces 30 derniers jours" : "aujourd'hui";
  const { actifs, inactifs } = activityByExpert(sessions, getPeriodCutoff(periode, now), experts);

  let out = `### 📊 Activité des Experts (${periodeLabel})\n\n`;

  if (actifs.length > 0) {
    out += `**Experts actifs (${actifs.length}) :**\n`;
    for (const stats of actifs) {
      const name = formatExpertDisplayName(stats.expert);
      out += `- **${name}** : ${stats.count} tâche(s) / session(s), dernière activité le ${formatDateFr(stats.lastActive)}\n`;
    }
  } else {
    out += `Aucun expert n'a enregistré d'activité ${periodeLabel}.\n`;
  }

  if (inactifs.length > 0) {
    out += `\n**Experts inactifs (${inactifs.length}) :**\n`;
    out += inactifs.map((exp) => formatExpertDisplayName(exp)).join(", ") + ".\n";
  }

  return out;
}

export function formatStatistiquesAnalytique(
  sessions: RawSessionInfo[],
  vue?: string,
  experts?: DiscoveredExpert[]
): string {
  const total = sessions.length;
  const sorted = sessionsPerProfile(sessions);
  const expertMap = new Map((experts ?? []).map((exp) => [exp.id.toLowerCase(), exp]));

  let out = `### 📈 Synthèse Analytique de l'Instance\n\n`;
  out += `- **Volume total d'interactions** : ${total} session(s) enregistrée(s)\n`;
  out += `- **Experts les plus sollicités** :\n`;
  for (const [exp, n] of sorted.slice(0, 5)) {
    const pct = total > 0 ? Math.round((n / total) * 100) : 0;
    const found = expertMap.get(exp);
    const name = found ? formatExpertDisplayName(found) : exp.charAt(0).toUpperCase() + exp.slice(1);
    out += `  - **${name}** : ${n} tâches (${pct}%)\n`;
  }
  if (vue === "routines") {
    out += `\n- **Routines automatiques** : Déclenchements actifs surveillés en tâche de fond.\n`;
  }
  return out;
}
