// La consommation des experts (toutes leurs sessions : conversations, routines, autres canaux), mise
// en texte. Les calculs sont dans ../summaries/consumption.ts.

import { channelName } from "../labels.ts";
import { masquerSecrets } from "../secrets.ts";
import { sharePct, summarizeConsumption, type ConsumptionRow, type ConsumptionSummary } from "../summaries/consumption.ts";
import type { DiscoveredExpert, ExpertUsageData } from "../types.ts";

const n = (v: number) => v.toLocaleString("fr-FR");

export function formatConsommationTokens(
  stats: Record<string, ExpertUsageData> | null,
  experts?: DiscoveredExpert[],
  targetExpert?: string,
  periodLabel?: string
): string {
  const period = periodLabel ? ` (${periodLabel})` : "";
  if (!stats || Object.keys(stats).length === 0) {
    return `Aucune donnée de consommation de tokens enregistrée sur l'instance${period}.`;
  }

  const summary = summarizeConsumption(stats, experts);
  const cleanTarget = targetExpert ? targetExpert.trim().toLowerCase() : undefined;
  if (!cleanTarget) return masquerSecrets(teamConsumption(summary, period));

  const single = summary.rows.find((r) => r.expId === cleanTarget);
  if (!single) {
    return `Aucune consommation enregistrée pour l'expert '${cleanTarget}'.`;
  }
  return masquerSecrets(expertConsumption(single, summary.totalTokens, period));
}

function expertConsumption(single: ConsumptionRow, teamTokens: number, period: string): string {
  let out = `### 🪙 Consommation de Tokens : ${single.name} (${single.role})${period}\n\n`;
  out += `- **Total Tokens consommés** : **${n(single.totalTokens)}** tokens\n`;
  out += `  - 📥 *Entrée (contexte, cache compris)* : ${n(single.promptTokens)} tokens (${sharePct(single.promptTokens, single.totalTokens)}%)\n`;
  out += `  - 📤 *Sortie (génération)* : ${n(single.completionTokens)} tokens (${sharePct(single.completionTokens, single.totalTokens)}%)\n`;
  out += `- **Sessions** : ${n(single.count)} (conversations, routines et autres canaux)\n`;
  out += `- **Durée moyenne d'une session terminée** : ${single.avgDurationSec}s\n`;
  out += `- **Part dans la consommation d'équipe** : **${sharePct(single.totalTokens, teamTokens)}%**\n`;
  out += `- **Routines en échec** : ${single.errors}\n\n`;

  const sources = Object.entries(single.sources ?? {}).sort((a, b) => b[1].tokens - a[1].tokens);
  if (sources.length > 0) {
    out += `#### 📡 Par canal :\n`;
    for (const [source, c] of sources) out += `- **${channelName(source)}** : ${n(c.tokens)} tokens, ${n(c.sessions)} session(s)\n`;
    out += `\n`;
  }
  if (single.models && Object.keys(single.models).length > 0) {
    out += `#### 🧠 Répartition des modèles LLM :\n`;
    for (const [mName, cnt] of Object.entries(single.models)) {
      out += `- **\`${mName}\`** : ${cnt} session(s)\n`;
    }
  }
  return out;
}

function teamConsumption(s: ConsumptionSummary, period: string): string {
  let out = `### 🪙 Analyse Globale de la Consommation de Tokens${period}\n\n`;
  out += `**Vue consolidée de l'instance Yelema :**\n`;
  out += `- **Volume total consommé** : **${n(s.totalTokens)}** tokens\n`;
  out += `  - 📥 *Tokens d'entrée (cache compris)* : ${n(s.promptTokens)} (${sharePct(s.promptTokens, s.totalTokens)}%)\n`;
  out += `  - 📤 *Tokens de sortie* : ${n(s.completionTokens)} (${sharePct(s.completionTokens, s.totalTokens)}%)\n`;
  out += `- **Sessions** : **${n(s.runs)}** (conversations, routines et autres canaux)\n`;
  out += `\n`;

  if (s.channels.length > 0) {
    out += `#### 📡 Par canal :\n\n`;
    out += `| Canal | Sessions | Tokens | Part |\n| :--- | :---: | :---: | :---: |\n`;
    for (const [source, c] of s.channels) out += `| ${channelName(source)} | ${n(c.sessions)} | ${n(c.tokens)} | ${sharePct(c.tokens, s.totalTokens)}% |\n`;
    out += `\n`;
  }

  out += `#### 🏆 Classement des Experts par Consommation de Tokens :\n\n`;
  out += `| Rang | Expert | Rôle | Sessions | Total Tokens | Part Équipe |\n`;
  out += `| :---: | :--- | :--- | :---: | :---: | :---: |\n`;
  s.rows.forEach((r, idx) => {
    out += `| ${idx + 1} | **${r.name}** | ${r.role} | ${n(r.count)} | **${n(r.totalTokens)}** | ${sharePct(r.totalTokens, s.totalTokens)}% |\n`;
  });
  return out;
}
