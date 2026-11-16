import type { PeriodWindow } from "./period.ts";
import type { ChartBreakdown, Dimension } from "./types.ts";

/** Nombre maximal de séries de la courbe, « Autres » compris. */
export const MAX_SERIES = 10;
export const OTHERS_SERIES = { id: "autres", name: "Autres" } as const;

/** Toutes les lignes ayant une valeur s'il y en a au plus `MAX_SERIES` ; sinon les `MAX_SERIES` - 1 premières, puis « Autres ». */
export function chartBreakdown(w: PeriodWindow, d: Dimension): ChartBreakdown {
  const totals = new Map<string, number>();
  for (const f of d.facts) totals.set(f.itemId, (totals.get(f.itemId) ?? 0) + f.value);
  const ranked = d.items.filter((i) => (totals.get(i.id) ?? 0) > 0);
  const top = ranked.length > MAX_SERIES ? ranked.slice(0, MAX_SERIES - 1) : ranked;
  const series = [...top.map((i) => ({ id: i.id, name: i.name })), ...(ranked.length > top.length ? [OTHERS_SERIES] : [])];
  const column = new Map(top.map((i, j) => [i.id, j]));
  const row = new Map(w.buckets.map((b, i) => [b.key, i]));
  const values = w.buckets.map(() => series.map(() => 0));
  for (const f of d.facts) {
    const i = row.get(w.bucketOf(f.slot));
    if (i === undefined) continue;
    const j = column.get(f.itemId) ?? (series.length > top.length ? top.length : undefined);
    if (j !== undefined) values[i][j] += f.value;
  }
  return { unit: d.unit, series, values };
}
