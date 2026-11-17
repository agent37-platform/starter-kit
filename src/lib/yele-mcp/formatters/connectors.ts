// L'état des connecteurs de l'instance.

import type { RawConnectionInfo } from "../types.ts";

export function formatAuditOutils(connections: RawConnectionInfo[], targetExpert?: string): string {
  const filtered = targetExpert
    ? connections.filter((c) => (c.toolkitSlug || "").toLowerCase().includes(targetExpert.toLowerCase()))
    : connections;

  let out = `### 🔌 Audit des Connecteurs et Outils\n\n`;
  if (filtered.length === 0) {
    out += `Aucun connecteur tiers n'est actuellement configuré${targetExpert ? ` pour ${targetExpert}` : ""}.\n`;
    return out;
  }

  out += `**État des connexions :**\n`;
  for (const c of filtered) {
    const name = c.toolkitSlug || "Outil";
    const status = c.status === "ACTIVE" && !c.isDisabled ? "✅ Actif" : "⚠️ À reconnecter / Inactif";
    const alias = c.alias ? ` (${c.alias})` : "";
    out += `- **${name}**${alias} : ${status}\n`;
  }
  return out;
}
