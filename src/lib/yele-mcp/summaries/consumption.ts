// Les calculs de la consommation : totaux de l'équipe, canaux, et ligne de chaque expert. Pas de texte ici.
import { expertRole } from "../experts.ts";
import type { ChannelUsage, DiscoveredExpert, ExpertUsageData } from "../types.ts";

export interface ConsumptionRow extends ExpertUsageData {
  expId: string;
  name: string;
  role: string;
  avgDurationSec: number;
}

export interface ConsumptionSummary {
  /** Du plus gros consommateur au plus petit. */
  rows: ConsumptionRow[];
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  /** Sessions : conversations, routines et tout autre canal. */
  runs: number;
  durationMs: number;
  /** Par canal d'origine, le plus consommateur d'abord. */
  channels: [string, ChannelUsage][];
}

export function summarizeConsumption(stats: Record<string, ExpertUsageData>, experts?: DiscoveredExpert[]): ConsumptionSummary {
  const expertMap = new Map((experts || []).map((e) => [e.id.toLowerCase(), e]));
  const summary: ConsumptionSummary = {
    rows: [],
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    runs: 0,
    durationMs: 0,
    channels: [],
  };
  const channels = new Map<string, ChannelUsage>();

  for (const [expId, data] of Object.entries(stats)) {
    summary.totalTokens += data.totalTokens;
    summary.promptTokens += data.promptTokens;
    summary.completionTokens += data.completionTokens;
    summary.runs += data.count;
    summary.durationMs += data.totalDurationMs || 0;
    for (const [source, c] of Object.entries(data.sources ?? {})) {
      const acc = channels.get(source) ?? channels.set(source, { sessions: 0, tokens: 0 }).get(source)!;
      acc.sessions += c.sessions;
      acc.tokens += c.tokens;
    }

    const expMeta = expertMap.get(expId.toLowerCase());
    summary.rows.push({
      expId: expId.toLowerCase(),
      name: expMeta ? expMeta.name : expId.charAt(0).toUpperCase() + expId.slice(1),
      role: expertRole(expMeta),
      ...data,
      avgDurationSec:
        data.avgDurationSec ||
        (data.count > 0 && data.totalDurationMs ? Math.round(data.totalDurationMs / data.count / 1000) : 0),
    });
  }

  summary.rows.sort((a, b) => b.totalTokens - a.totalTokens);
  summary.channels = [...channels].sort((a, b) => b[1].tokens - a[1].tokens);
  return summary;
}

/** La part de `part` dans `total`, en pourcentage à une décimale ("0.0" quand le total est nul). */
export function sharePct(part: number, total: number): string {
  return total > 0 ? ((part / total) * 100).toFixed(1) : "0.0";
}
