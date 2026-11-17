import type { SessionUsageRow } from "../yele-mcp/types.ts";
import { isExpertProfile } from "./experts.ts";
import type { PeriodWindow } from "./period.ts";
import type { TimeSeriesPoint } from "./types.ts";

/** Un point par tranche de la période, tranches vides comprises. */
export function buildTimeline(w: PeriodWindow, rows: SessionUsageRow[]): TimeSeriesPoint[] {
  const active = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!isExpertProfile(r.profile)) continue;
    const key = w.bucketOf(r.slot);
    (active.get(key) ?? active.set(key, new Set()).get(key)!).add(r.profile);
  }
  return w.buckets.map((b) => ({ key: b.key, label: b.label, partial: b.start <= w.to && w.to < b.end, expertsActive: active.get(b.key)?.size ?? 0 }));
}
