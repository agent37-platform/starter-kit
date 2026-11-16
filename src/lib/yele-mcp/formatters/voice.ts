// Les appels et les briefs vocaux des experts.

import { expertRole, formatExpertDisplayName } from "../experts.ts";
import { masquerSecrets } from "../secrets.ts";
import type { DiscoveredExpert, VoiceBriefInfo } from "../types.ts";

export function formatAppelsEtVoix(
  briefs: VoiceBriefInfo[] | null,
  experts?: DiscoveredExpert[],
  targetExpert?: string
): string {
  const cleanTarget = targetExpert ? targetExpert.trim().toLowerCase() : undefined;
  const expertMap = new Map((experts || []).map((e) => [e.id.toLowerCase(), e]));
  const list = briefs || [];

  if (cleanTarget) {
    const expMeta = expertMap.get(cleanTarget);
    const expName = expMeta ? formatExpertDisplayName(expMeta) : cleanTarget.charAt(0).toUpperCase() + cleanTarget.slice(1);
    const item = list.find((b) => b.expId.toLowerCase() === cleanTarget);

    let out = `### 📞 Module Vocal & Brief d'Appel : ${expName}\n\n`;
    if (item && item.at) {
      const d = new Date(item.at);
      const dateStr = d.toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      out += `- **Dernier brief généré** : le ${dateStr}\n\n`;
      out += `#### 📋 Contenu du Brief d'Avant-Appel :\n\`\`\`text\n${(item.text || "").trim()}\n\`\`\`\n`;
    } else {
      out += `- **Brief d'appel** : Aucun brief récent préparé pour cet expert.\n`;
    }
    return masquerSecrets(out);
  }

  let out = `### 📞 Supervision des Appels Vocaux & Briefs de l'Équipe\n\n`;
  out += `- **Briefs d'avant-appel prêts** : ${list.length} expert(s) synchronisé(s)\n\n`;
  out += `| Expert | Rôle | Dernier Brief Vocal | Extrait Contexte |\n`;
  out += `| :--- | :--- | :---: | :--- |\n`;

  const allExperts =
    experts && experts.length > 0
      ? experts
      : list.map((b) => ({ id: b.expId, name: b.expId.charAt(0).toUpperCase() + b.expId.slice(1), description: "" }));

  for (const exp of allExperts) {
    const role = expertRole(exp);
    const item = list.find((b) => b.expId.toLowerCase() === exp.id.toLowerCase());
    let dateStr = "—";
    let preview = "Aucun brief";
    if (item && item.at) {
      const d = new Date(item.at);
      dateStr = d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      const firstLine = (item.text || "").split("\n").filter((l) => l.trim())[0] || "";
      preview = firstLine.length > 50 ? firstLine.slice(0, 50) + "..." : firstLine;
    }
    out += `| **${exp.name}** | ${role} | ${dateStr} | ${preview} |\n`;
  }

  return masquerSecrets(out);
}
