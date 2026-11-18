"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useOwnAgentId } from "@/components/conversations/useAllConversations";
import { DEFAULT_QUERY, type AnalyticsQuery } from "@/lib/analytics/query";
import type { AnalyticsFilters, AnalyticsItem, AnalyticsOverview, TabKey } from "@/lib/analytics/types";
import { ConsumptionChart } from "./ConsumptionChart";
import { DimensionsTable, visibleTabs } from "./DimensionsTable";
import { ActiveFilters, FiltersDialog } from "./FiltersDialog";
import { KpiCards } from "./KpiCards";
import { GranularityPicker, PeriodPicker } from "./PeriodPicker";
import { useAnalytics } from "./useAnalytics";

const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

/** Ligne sous le titre : période, experts actifs si les sessions sont lues, experts illisibles. */
function headline(data: AnalyticsOverview): string {
  const { activeExperts: n, totalExperts } = data.totals;
  const parts = [`${day(data.from)} – ${day(data.to)}`];
  if (data.readable.usage) parts.push(`${n} expert${n > 1 ? "s" : ""} actif${n > 1 ? "s" : ""} sur ${totalExperts}`);
  if (data.readable.unreadableExperts.length > 0) parts.push(`Illisible : ${data.readable.unreadableExperts.join(", ")}`);
  return parts.join(" · ");
}

export function AnalyticsDashboard() {
  const agentId = useOwnAgentId();
  const [query, setQuery] = useState<AnalyticsQuery>(DEFAULT_QUERY);
  const [tab, setTab] = useState<TabKey>("experts");
  const { data, error } = useAnalytics(agentId, query);
  // Opened from an expert's profile (« Analytics »): already filtered on it.
  useEffect(() => {
    const experts = new URLSearchParams(window.location.search).get("experts");
    if (experts) setQuery((q) => ({ ...q, filters: { ...q.filters, experts: experts.split(",").filter(Boolean) } }));
  }, []);

  const setFilters = (filters: AnalyticsFilters) => setQuery((q) => ({ ...q, filters }));
  const toggleFilter = ({ dimension, value }: NonNullable<AnalyticsItem["filter"]>) =>
    setQuery((q) => {
      const current = q.filters[dimension];
      return { ...q, filters: { ...q.filters, [dimension]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] } };
    });
  const shownTab = data && !visibleTabs(data).some((t) => t.key === tab) ? "experts" : tab;

  return (
    <div className="space-y-6 pb-20 pt-2 text-ink">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          {data && <p className="text-xs text-ink-3">{headline(data)}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker value={query.period} onChange={(period) => setQuery((q) => ({ ...q, period }))} />
          <GranularityPicker period={query.period} value={query.granularity} onChange={(granularity) => setQuery((q) => ({ ...q, granularity }))} />
          {data && <FiltersDialog options={data.filterOptions} value={query.filters} onApply={setFilters} />}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("yelema:open-yele"))}
            className="inline-flex h-9 items-center gap-2 rounded-[12px] bg-surface px-3.5 text-[13px] font-bold text-ink shadow-2xs ring-1 ring-line hover:bg-soft"
          >
            <Sparkles className="size-3.5 text-brand" />
            Demander à Yélé
          </button>
        </div>
      </div>

      {data && <ActiveFilters options={data.filterOptions} value={query.filters} onChange={setFilters} />}

      {error && !data && <p className="rounded-xl border border-line bg-surface p-4 text-sm text-ink-2">{error}</p>}

      {data ? (
        <>
          <KpiCards data={data} />
          <ConsumptionChart data={data} tab={shownTab} />
          <DimensionsTable data={data} tab={shownTab} onTab={setTab} onFilter={toggleFilter} />
        </>
      ) : (
        !error && <div className="h-64 animate-pulse rounded-[22px] border border-line bg-soft/40" />
      )}
    </div>
  );
}
