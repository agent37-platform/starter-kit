// Les compétences des experts.

import { expertRole, formatExpertDisplayName } from "../experts.ts";
import { masquerSecrets } from "../secrets.ts";
import type { DiscoveredExpert, ExpertSkillInfo } from "../types.ts";

export function formatSkillsExperts(
  skills: ExpertSkillInfo[] | null,
  experts?: DiscoveredExpert[],
  targetExpert?: string
): string {
  const cleanTarget = targetExpert ? targetExpert.trim().toLowerCase() : undefined;
  const expertMap = new Map((experts || []).map((e) => [e.id.toLowerCase(), e]));
  const list = skills || [];

  if (cleanTarget) {
    const expMeta = expertMap.get(cleanTarget);
    const expName = expMeta ? formatExpertDisplayName(expMeta) : cleanTarget.charAt(0).toUpperCase() + cleanTarget.slice(1);
    const item = list.find((s) => s.expId.toLowerCase() === cleanTarget);

    if (!item) {
      return `Aucune compétence spécifique enregistrée pour ${expName}.`;
    }

    let out = `### 🎯 Compétences & Méthodologies Métiers : ${expName}\n\n`;
    if (item.specific && item.specific.length > 0) {
      out += `#### 💼 Modes Opératoires et Fiches Métier Spécifiques (${item.specific.length}) :\n`;
      for (const s of item.specific) {
        out += `- **\`${s}\`**\n`;
      }
      out += `\n`;
    }
    if (item.shared && item.shared.length > 0) {
      out += `#### 🛠️ Compétences Transverses & Outils Disponibles :\n`;
      out += item.shared.map((s) => `- \`${s}\``).join("\n") + "\n";
    }

    return masquerSecrets(out);
  }

  let out = `### 🎯 Cartographie des Compétences Métiers de l'Équipe\n\n`;
  out += `| Expert | Rôle | Modules Spécifiques | Compétences Transverses |\n`;
  out += `| :--- | :--- | :---: | :--- |\n`;

  const allExperts =
    experts && experts.length > 0
      ? experts
      : list.map((s) => ({ id: s.expId, name: s.expId.charAt(0).toUpperCase() + s.expId.slice(1), description: "" }));

  for (const exp of allExperts) {
    const role = expertRole(exp);
    const item = list.find((s) => s.expId.toLowerCase() === exp.id.toLowerCase());
    const specCount = item?.specific?.length ?? 0;
    const sharedCount = item?.shared?.length ?? 0;
    out += `| **${exp.name}** | ${role} | **${specCount}** fiches | ${sharedCount} transverses |\n`;
  }

  out += `\n*(Pour consulter les modules détaillés d'un expert, précisez : \`consulter_skills_experts(expert="djeneba")\`)*`;
  return masquerSecrets(out);
}
