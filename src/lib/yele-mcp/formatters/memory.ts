// Les résultats d'une recherche dans la mémoire des experts.

import { formatExpertDisplayName } from "../experts.ts";
import { masquerSecrets } from "../secrets.ts";
import type { DiscoveredExpert, MemorySearchResult } from "../types.ts";

export function formatRechercheMemoire(
  query: string,
  results: MemorySearchResult[] | null,
  experts?: DiscoveredExpert[],
  targetExpert?: string
): string {
  if (!query || !query.trim()) {
    return "Veuillez préciser un terme ou mot-clé de recherche (ex: 'réunion', 'budget', 'client').";
  }

  const cleanTarget = targetExpert ? targetExpert.trim().toLowerCase() : undefined;
  const expertMap = new Map((experts || []).map((e) => [e.id.toLowerCase(), e]));
  const list = results || [];

  if (list.length === 0) {
    const targetName = cleanTarget
      ? expertMap.get(cleanTarget)?.name || cleanTarget
      : "dans les mémoires des experts";
    return `Aucune mention trouvée pour la recherche **"${query}"** ${cleanTarget ? `chez ${targetName}` : targetName}.`;
  }

  let out = `### 🔍 Résultats de Recherche dans la Mémoire : "${query}"\n\n`;
  out += `*${list.length} expert(s) ont des correspondances dans leur mémoire durable :*\n\n`;

  for (const r of list) {
    const expMeta = expertMap.get(r.expId.toLowerCase());
    const expName = expMeta ? formatExpertDisplayName(expMeta) : r.expId.charAt(0).toUpperCase() + r.expId.slice(1);
    out += `#### 📌 ${expName} (${r.matches.length} extrait(s)) :\n`;
    for (const m of r.matches) {
      out += `> ${m.replace(/\n+/g, " ")}\n\n`;
    }
  }

  return masquerSecrets(out);
}
