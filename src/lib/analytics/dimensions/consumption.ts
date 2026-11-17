import { tokensOf } from "../../yele-mcp/session-usage/usage.ts";
import type { SessionUsageRow } from "../../yele-mcp/types.ts";
import { groupTotals, percent, sumTotals } from "../totals.ts";
import type { AnalyticsItem, Dimension, UsageTotals } from "../types.ts";

/** Onglet de consommation : une ligne par clé (`toItem`, part en tokens), et un point par ligne de consommation. */
export function consumptionDimension(
  rows: SessionUsageRow[],
  keyOf: (r: SessionUsageRow) => string,
  toItem: (key: string, totals: UsageTotals, share: number) => AnalyticsItem
): Dimension {
  const total = sumTotals(rows);
  const idOf = new Map<string, string>();
  const items = groupTotals(rows, keyOf).map(([key, t]) => {
    const item = toItem(key, t, percent(t.tokens, total.tokens));
    idOf.set(key, item.id);
    return item;
  });
  const facts = rows.map((r) => ({ slot: r.slot, itemId: idOf.get(keyOf(r))!, value: tokensOf(r) }));
  return { items, facts, unit: "tokens" };
}
