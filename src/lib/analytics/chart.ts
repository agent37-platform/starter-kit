import type { ChartBreakdown, TimeSeriesPoint } from "./types.ts";

export interface BarSegment {
  id: string;
  name: string;
  value: number;
}

export interface Bar {
  key: string;
  label: string;
  partial: boolean;
  total: number;
  segments: BarSegment[];
  expertsActive: number;
}

/** Une barre par point ; ses segments sont les valeurs non nulles des séries du découpage, dans leur ordre. */
export function stackedBars(timeline: TimeSeriesPoint[], chart: ChartBreakdown): Bar[] {
  return timeline.map((p, i) => {
    const segments = chart.series.map((s, j) => ({ id: s.id, name: s.name, value: chart.values[i]?.[j] ?? 0 })).filter((s) => s.value > 0);
    return { key: p.key, label: p.label, partial: p.partial, total: segments.reduce((s, x) => s + x.value, 0), segments, expertsActive: p.expertsActive };
  });
}

/** Total cumulé des barres, point par point. */
export function runningTotal(bars: Bar[]): number[] {
  let sum = 0;
  return bars.map((b) => (sum += b.total));
}

/** Le plus petit 1, 2 ou 5 × 10ⁿ supérieur ou égal à `n` ; 0 si `n` ≤ 0. */
export function niceMax(n: number): number {
  if (n <= 0) return 0;
  const step = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 5, 10].map((k) => k * step).find((v) => v >= n)!;
}

/** Graduations de l'échelle, du haut jusqu'à 0. */
export function ticks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  return Array.from({ length: count + 1 }, (_, i) => (max * (count - i)) / count);
}
