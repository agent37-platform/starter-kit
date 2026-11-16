import { NOT_EXPERTS } from "../yele-mcp/hermes-layout.ts";
import type { DiscoveredExpert, SessionUsageRow } from "../yele-mcp/types.ts";
import { profileName } from "../yele-mcp/labels.ts";
import { expertTitle } from "./names.ts";
import { groupTotals, percent, sumTotals } from "./totals.ts";
import type { ExpertMetric } from "./types.ts";

/** Indique si un profil est un expert, et non le profil principal ou Yélé. */
export const isExpertProfile = (profile: string): boolean => !NOT_EXPERTS.includes(profile);

/** Une ligne par expert de l'annuaire et par profil ayant consommé ; un profil absent de l'annuaire garde son id. */
export function expertMetrics(rows: SessionUsageRow[], directory: DiscoveredExpert[]): ExpertMetric[] {
  const total = sumTotals(rows);
  const byProfile = new Map(groupTotals(rows, (r) => r.profile));
  const ids = [...new Set([...directory.map((e) => e.id), ...byProfile.keys()])];
  const named = new Map(directory.map((e) => [e.id, e]));

  return ids
    .map((id) => {
      const t = byProfile.get(id);
      const e = named.get(id);
      return {
        id,
        name: e?.name || profileName(id),
        role: expertTitle(e?.description ?? ""),
        messages: t?.messages ?? 0,
        tokens: t?.tokens ?? 0,
        tokensPercent: percent(t?.tokens ?? 0, total.tokens),
        isActive: t !== undefined,
        isExpert: isExpertProfile(id),
      };
    })
    .sort((a, b) => b.tokens - a.tokens || b.messages - a.messages || a.name.localeCompare(b.name, "fr"));
}
