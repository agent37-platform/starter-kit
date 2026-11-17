// Les routines des experts : leur planning et leur historique.

import { scheduleLabel, type RunOutcome } from "../../routines.ts";
import { isExpert } from "../experts.ts";
import { DAY_MS, formatDateFr } from "../periods.ts";
import type { ExpertRoutineRuns, ExpertRoutines } from "../types.ts";

export function formatRoutinesPlanning(list: ExpertRoutines[], targetExpert?: string): string {
  const chosen = targetExpert ? list.filter((r) => isExpert({ id: r.expId, name: r.expertName }, targetExpert)) : list;
  if (chosen.length === 0) return targetExpert ? `Aucun expert ne correspond à « ${targetExpert} ».` : "Aucun expert n'est installé sur l'instance.";
  const when = (iso: string | null) => (iso ? formatDateFr(Date.parse(iso)) : "—");
  let out = `### ⏰ Routines et planning des Experts\n\n`;
  for (const exp of chosen) {
    if (!exp.routines) {
      out += `**${exp.expertName}** : ses routines sont illisibles pour le moment.\n\n`;
      continue;
    }
    out += `**${exp.expertName}** : ${exp.routines.length} routine(s), ${exp.routines.filter((r) => r.enabled).length} active(s)\n`;
    for (const r of exp.routines) {
      const state = r.enabled ? "✅ active" : r.suggested ? "💡 proposée, jamais activée" : "⏸️ en pause";
      out += `- **${r.name}** (${state}) : ${scheduleLabel(r.schedule)}`;
      if (r.enabled) out += ` ; prochaine : ${when(r.nextRunAt)}`;
      out += ` ; dernière : ${when(r.lastRunAt)}\n`;
    }
    out += `\n`;
  }
  return out;
}

const OUTCOME: Record<RunOutcome, string> = { sent: "✅ envoyée", silent: "💤 rien à signaler", failed: "❌ échec" };

export function formatHistoriqueRoutines(list: ExpertRoutineRuns[], targetExpert?: string, now = Date.now()): string {
  if (list.length === 0) return targetExpert ? `Aucun expert ne correspond à « ${targetExpert} ».` : "Aucun expert n'est installé sur l'instance.";
  const weekAgo = now - 7 * DAY_MS;
  let out = `### 🕑 Historique des routines\n\n`;
  for (const exp of list) {
    if (!exp.routines) {
      out += `**${exp.expertName}** : l'historique de ses routines est illisible pour le moment.\n\n`;
      continue;
    }
    out += `**${exp.expertName}**\n`;
    if (exp.routines.length === 0) out += `- Aucune routine.\n`;
    for (const r of exp.routines) {
      const last = r.runs[0];
      if (!last) {
        out += `- **${r.name}** : n'a encore jamais tourné${r.enabled ? "" : " (en pause)"}\n`;
      } else if (!targetExpert) {
        const week = r.runs.filter((x) => x.at >= weekAgo).length;
        out += `- **${r.name}** : dernière exécution le ${formatDateFr(last.at)}, ${week} exécution(s) sur 7 jours\n`;
      } else {
        out += `- **${r.name}** :\n`;
        for (const run of r.runs) out += `  - ${formatDateFr(run.at)} : ${run.outcome ? OUTCOME[run.outcome] : "résultat illisible"}\n`;
      }
    }
    out += `\n`;
  }
  if (!targetExpert) out += `*(Pour le résultat de chaque exécution, précisez l'expert.)*`;
  return out;
}
