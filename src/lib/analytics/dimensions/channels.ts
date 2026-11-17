import { isChannelConnected } from "../../channels.ts";
import { ACCESS_CHANNELS } from "../../yele-mcp/hermes-layout.ts";
import type { ChannelState, SessionUsageRow } from "../../yele-mcp/types.ts";
import { channelName } from "../../yele-mcp/labels.ts";
import type { AnalyticsItem, Dimension } from "../types.ts";
import { consumptionDimension } from "./consumption.ts";

const isAccessChannel = (id: string) => ACCESS_CHANNELS.includes(id);
const idOf = (source: string) => `channel_${source}`;

function idleChannel(c: ChannelState): AnalyticsItem {
  return {
    id: idOf(c.id),
    name: c.name || channelName(c.id),
    iconKind: c.id,
    filter: { dimension: "channels", value: c.id },
    share: 0,
    volume: { value: 0, unit: "tokens" },
    count: 0,
  };
}

/** `keepIdle` : indique si un canal connecté sans activité sur la période est listé. */
export function channelsTab(rows: SessionUsageRow[], channels: ChannelState[] | null, keepIdle: (source: string) => boolean): Dimension {
  const used = consumptionDimension(
    rows.filter((r) => isAccessChannel(r.source)),
    (r) => r.source,
    (source, t, share) => ({
      id: idOf(source),
      name: channelName(source),
      iconKind: source,
      filter: { dimension: "channels", value: source },
      share,
      volume: { value: t.tokens, unit: "tokens" },
      count: t.messages,
    })
  );
  const seen = new Set(used.items.map((i) => i.id));
  const idle = (channels ?? []).filter((c) => isChannelConnected(c) && isAccessChannel(c.id) && !seen.has(idOf(c.id)) && keepIdle(c.id)).map(idleChannel);
  return { ...used, items: [...used.items, ...idle] };
}
