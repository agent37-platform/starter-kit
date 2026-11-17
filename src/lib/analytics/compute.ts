import { buildDimensions, buildFilterOptions, type DimensionInputs, type PeriodUsage } from "./dimensions.ts";
import { deliverableSummaries } from "./deliverables.ts";
import { expertMetrics } from "./experts.ts";
import { hasFilters, matchesFilters, NO_FILTERS } from "./filters.ts";
import { inWindow, isoDay, periodWindow, type PeriodWindow } from "./period.ts";
import { buildTimeline } from "./timeline.ts";
import { sumTotals } from "./totals.ts";
import type { AnalyticsFilters, AnalyticsOverview, ComputeAnalyticsParams } from "./types.ts";
import { profileName } from "../yele-mcp/labels.ts";
import type { DiscoveredExpert, SessionUsage } from "../yele-mcp/types.ts";

function periodUsage(usage: SessionUsage | null, w: PeriodWindow): PeriodUsage {
  const keep = <R extends { slot: string }>(rows: R[] | undefined) => (rows ?? []).filter((r) => inWindow(w, r.slot));
  return { rows: keep(usage?.rows), tools: keep(usage?.tools), skills: keep(usage?.skills), composio: keep(usage?.composio) };
}

function unreadableNames(usage: SessionUsage | null, directory: DiscoveredExpert[]): string[] {
  const names = new Map(directory.map((e) => [e.id, e.name]));
  return (usage?.unreadable ?? []).map((id) => names.get(id) || profileName(id));
}

function filtered(u: PeriodUsage, f: AnalyticsFilters): PeriodUsage {
  const keep = <R extends Parameters<typeof matchesFilters>[0]>(rows: R[]) => rows.filter((r) => matchesFilters(r, f));
  return { rows: keep(u.rows), tools: keep(u.tools), skills: keep(u.skills), composio: keep(u.composio) };
}

export function computeAnalytics(p: ComputeAnalyticsParams): AnalyticsOverview {
  const w = periodWindow(p.period, p.now, p.granularity);
  const all = periodUsage(p.usage, w);
  const usage = filtered(all, p.filters);
  const directory = p.experts ?? [];
  const shownDirectory = p.filters.experts.length > 0 ? directory.filter((e) => p.filters.experts.includes(e.id)) : directory;
  const metrics = expertMetrics(usage.rows, shownDirectory);
  const actualExperts = metrics.filter((m) => m.isExpert);
  const files = deliverableSummaries(p.deliverables ?? []).filter((f) => f.modified !== null && inWindow(w, isoDay(f.modified)));
  const inputs = (u: PeriodUsage, filters: AnalyticsFilters, experts = metrics): DimensionInputs => ({
    usage: u,
    filters,
    setup: p.setup,
    connections: p.connections,
    channels: p.channels,
    modelLabels: p.modelLabels,
    experts,
    deliverables: files,
  });
  const { dimensions, charts } = buildDimensions(w, inputs(usage, p.filters));
  const filterOptions = buildFilterOptions(inputs(all, NO_FILTERS, hasFilters(p.filters) ? expertMetrics(all.rows, directory) : metrics));

  return {
    period: p.period,
    granularity: p.granularity,
    filters: p.filters,
    filterOptions,
    from: new Date(w.from).toISOString(),
    to: new Date(w.to).toISOString(),
    readable: { usage: p.usage !== null, deliverables: p.deliverables !== null, unreadableExperts: unreadableNames(p.usage, directory) },
    totals: {
      ...sumTotals(usage.rows),
      activeExperts: actualExperts.filter((m) => m.isActive).length,
      totalExperts: actualExperts.length,
    },
    timeline: buildTimeline(w, usage.rows),
    charts,
    experts: metrics,
    dimensions,
  };
}
