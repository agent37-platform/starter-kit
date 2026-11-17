import { isoHour } from "../period.ts";
import { percent } from "../totals.ts";
import type { DeliverableSummary, Dimension } from "../types.ts";

/** Le nom de chaque format reconnu par drive-links ; un autre format garde son identifiant. */
const FORMAT_NAMES: Record<string, string> = {
  excel: "Tableurs",
  word: "Documents texte",
  powerpoint: "Présentations",
  pdf: "PDF",
  image: "Images",
  video: "Vidéos",
  audio: "Audio",
  other: "Autres formats",
};

/** `files` : livrables modifiés sur la période. */
export function deliverablesTab(files: DeliverableSummary[]): Dimension {
  const byKind = new Map<string, { count: number; bytes: number }>();
  for (const f of files) {
    const k = byKind.get(f.kind) ?? byKind.set(f.kind, { count: 0, bytes: 0 }).get(f.kind)!;
    k.count++;
    k.bytes += f.size ?? 0;
  }
  const items = [...byKind]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([kind, k]) => ({
      id: `format_${kind}`,
      name: FORMAT_NAMES[kind] ?? kind,
      iconKind: kind,
      share: percent(k.count, files.length),
      volume: { value: k.bytes, unit: "octets" as const },
      count: k.count,
    }));
  const facts = files.flatMap((f) => (f.modified === null ? [] : [{ slot: isoHour(f.modified), itemId: `format_${f.kind}`, value: 1 }]));
  return { items, facts, unit: "fichiers" };
}
