import { tokensOf } from "../../yele-mcp/session-usage/usage.ts";
import type { SessionUsageRow } from "../../yele-mcp/types.ts";
import type { Dimension, ExpertMetric } from "../types.ts";

export function expertsTab(experts: ExpertMetric[], rows: SessionUsageRow[]): Dimension {
  return {
    items: experts.map((e) => ({
      id: e.id,
      name: e.name,
      subtitle: e.role && !e.name.toLowerCase().includes(e.role.toLowerCase()) ? e.role : undefined,
      iconKind: "expert",
      filter: { dimension: "experts", value: e.id },
      share: e.tokensPercent,
      volume: { value: e.tokens, unit: "tokens" },
      count: e.messages,
    })),
    facts: rows.map((r) => ({ slot: r.slot, itemId: r.profile, value: tokensOf(r) })),
    unit: "tokens",
  };
}
