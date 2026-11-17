import { MAX_SERIES, OTHERS_SERIES } from "@/lib/analytics/breakdown";
import type { ChartBreakdown } from "@/lib/analytics/types";

const OTHERS_COLOR = "var(--ink-3)";

/** Couleur d'une série de la courbe selon son rang. */
export const seriesColor = (id: string, index: number): string =>
  id === OTHERS_SERIES.id ? OTHERS_COLOR : `var(--chart-${(index % MAX_SERIES) + 1})`;

/** Couleur de chaque ligne selon sa série dans la courbe ; une ligne regroupée dans « Autres » ou absente prend la couleur de « Autres ». */
export function expertColors(chart: ChartBreakdown): (id: string) => string {
  const index = new Map(chart.series.map((s, i) => [s.id, i]));
  return (id) => {
    const i = index.get(id);
    return i === undefined ? OTHERS_COLOR : seriesColor(id, i);
  };
}
