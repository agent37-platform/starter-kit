import { tokensOf } from "../yele-mcp/session-usage/usage.ts";
import type { SessionMetrics } from "../yele-mcp/types.ts";
import type { UsageTotals } from "./types.ts";

export function emptyTotals(): UsageTotals {
  return { sessions: 0, messages: 0, tokens: 0 };
}

export function addTotals(acc: UsageTotals, m: SessionMetrics): UsageTotals {
  acc.sessions += m.sessions;
  acc.messages += m.messages;
  acc.tokens += tokensOf(m);
  return acc;
}

export function sumTotals<R extends SessionMetrics>(rows: R[]): UsageTotals {
  return rows.reduce(addTotals, emptyTotals());
}

/** Totaux par clé, du plus gros au plus petit consommateur. */
export function groupTotals<R extends SessionMetrics>(rows: R[], keyOf: (r: R) => string): [string, UsageTotals][] {
  const groups = new Map<string, UsageTotals>();
  for (const r of rows) {
    const key = keyOf(r);
    addTotals(groups.get(key) ?? groups.set(key, emptyTotals()).get(key)!, r);
  }
  return [...groups].sort((a, b) => b[1].tokens - a[1].tokens || b[1].messages - a[1].messages);
}

/** Part en pourcentage entier ; 0 si le total est nul. */
export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}
