import type { CallCountRow } from "../../yele-mcp/types.ts";
import { percent } from "../totals.ts";
import type { AnalyticsItem, Dimension } from "../types.ts";

interface CallGroup {
  calls: number;
  profiles: Set<string>;
}

/** Invocations par sujet (`keyOf` d'une ligne ; null l'écarte), du plus invoqué au moins invoqué. */
function groupCalls(rows: CallCountRow[], keyOf: (r: CallCountRow) => string | null): Map<string, CallGroup> {
  const groups = new Map<string, CallGroup>();
  for (const r of rows) {
    const key = keyOf(r);
    if (key === null) continue;
    const g = groups.get(key) ?? groups.set(key, { calls: 0, profiles: new Set() }).get(key)!;
    g.calls += r.calls;
    g.profiles.add(r.profile);
  }
  return new Map([...groups].sort((a, b) => b[1].calls - a[1].calls));
}

export function callsDimension(
  rows: CallCountRow[],
  keyOf: (r: CallCountRow) => string | null,
  toItem: (key: string, group: CallGroup, share: number) => AnalyticsItem
): Dimension {
  const groups = groupCalls(rows, keyOf);
  const total = [...groups.values()].reduce((s, g) => s + g.calls, 0);
  const idOf = new Map<string, string>();
  const items = [...groups].map(([key, g]) => {
    const item = toItem(key, g, percent(g.calls, total));
    idOf.set(key, item.id);
    return item;
  });
  const facts = rows.flatMap((r) => {
    const key = keyOf(r);
    return key === null ? [] : [{ slot: r.slot, itemId: idOf.get(key)!, value: r.calls }];
  });
  return { items, facts, unit: "invocations" };
}

export const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;

/** Noms des profils triés, les `shown` premiers puis « et N autres ». */
export function whoLabel(profiles: Iterable<string>, nameOf: (profile: string) => string, shown = 2): string {
  const names = [...profiles].map(nameOf).sort((a, b) => a.localeCompare(b, "fr"));
  if (names.length <= shown + 1) return names.length > 1 ? `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}` : names[0] ?? "";
  return `${names.slice(0, shown).join(", ")} et ${names.length - shown} autres`;
}
