// Les derniers livrables du drive.

import { formatDateFr } from "../periods.ts";
import type { RawFileInfo } from "../types.ts";

export function formatLivrablesRecents(files: RawFileInfo[], limite = 10): string {
  const validFiles = files
    .filter((f) => f && f.name && !f.name.startsWith(".") && !f.name.startsWith("_"))
    .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0))
    .slice(0, Math.min(Math.max(limite, 1), 50));

  if (validFiles.length === 0) {
    return "Aucun livrable récent dans le dossier `~/Livrables`.";
  }

  let out = `### 📁 Derniers Livrables Produits (${validFiles.length})\n\n`;
  for (const f of validFiles) {
    const dateStr = f.modified ? formatDateFr(f.modified < 1e11 ? f.modified * 1000 : f.modified) : "Date inconnue";
    const sizeKb = f.size ? `(${Math.round(f.size / 1024)} Ko)` : "";
    out += `- 📄 **${f.name}** ${sizeKb} — modifié le ${dateStr}\n`;
  }
  return out;
}
