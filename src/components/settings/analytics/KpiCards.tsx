"use client";

import type { AnalyticsOverview } from "@/lib/analytics/types";
import { formatCompact, formatWhole } from "@/lib/analytics/format";

function Card({ title, value, detail }: { title: string; value: string; detail?: string }) {
  return (
    <div className="rounded-[22px] border border-line bg-surface p-5 shadow-xs">
      <span className="text-xs font-semibold text-ink-3">{title}</span>
      <p className="mt-2 truncate font-display text-[26px] font-bold tracking-tight text-ink">{value}</p>
      {detail && <p className="mt-1 truncate text-xs text-ink-3">{detail}</p>}
    </div>
  );
}

export function KpiCards({ data }: { data: AnalyticsOverview }) {
  const { totals, experts, readable } = data;

  if (!readable.usage) {
    return <div className="rounded-[22px] border border-line bg-surface p-5 text-sm text-ink-2 shadow-xs">Consommation illisible</div>;
  }

  const top = experts.find((e) => e.isExpert && e.tokens > 0);
  const perMessage = totals.messages > 0 ? totals.tokens / totals.messages : 0;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card title="Consommation de la période" value={`${formatCompact(totals.tokens)} tokens`} />
      <Card title="Messages" value={formatWhole(totals.messages)} detail={`${formatCompact(perMessage)} tokens / message`} />
      <Card title="Top expert" value={top ? top.name : "—"} detail={top ? `${top.tokensPercent} % de la consommation` : undefined} />
    </div>
  );
}
