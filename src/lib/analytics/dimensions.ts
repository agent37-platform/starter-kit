import { chartBreakdown } from "./breakdown.ts";
import { channelsTab } from "./dimensions/channels.ts";
import { connectorsTab } from "./dimensions/connectors.ts";
import { deliverablesTab } from "./dimensions/deliverables.ts";
import { expertsTab } from "./dimensions/experts.ts";
import { mcpTab } from "./dimensions/mcp.ts";
import { modelsTab } from "./dimensions/models.ts";
import { routinesTab } from "./dimensions/routines.ts";
import { skillsTab } from "./dimensions/skills.ts";
import { matchesKnownDims } from "./filters.ts";
import type { PeriodWindow } from "./period.ts";
import { SESSION_SOURCES } from "../yele-mcp/hermes-layout.ts";
import { profileName } from "../yele-mcp/labels.ts";
import type { ChannelState, InstanceSetup, RawConnectionInfo, SessionUsage } from "../yele-mcp/types.ts";
import type { AnalyticsFilters, ChartBreakdown, DeliverableSummary, Dimension, DimensionsData, ExpertMetric, FilterOptions, TabKey } from "./types.ts";

export type PeriodUsage = Pick<SessionUsage, "rows" | "tools" | "skills" | "composio">;

export interface DimensionInputs {
  usage: PeriodUsage;
  filters: AnalyticsFilters;
  setup: InstanceSetup | null;
  connections: RawConnectionInfo[] | null;
  channels: ChannelState[] | null;
  modelLabels: Record<string, string> | null;
  experts: ExpertMetric[];
  deliverables: DeliverableSummary[];
}

const nameOfExperts = (experts: ExpertMetric[]) => {
  const names = new Map(experts.map((e) => [e.id, e.name]));
  return (profile: string) => names.get(profile) ?? profileName(profile);
};

/** Onglets filtrables : ceux dont chaque ligne correspond à une valeur de filtre. */
function filterableTabs(p: DimensionInputs, nameOf: (profile: string) => string) {
  return {
    experts: expertsTab(p.experts, p.usage.rows),
    channels: channelsTab(p.usage.rows, p.channels, (source) => matchesKnownDims({ source }, p.filters)),
    routines: routinesTab(p.usage.rows, p.setup, nameOf, (profile, routine) =>
      matchesKnownDims({ profile, source: SESSION_SOURCES.routine, routine }, p.filters)
    ),
    models: modelsTab(p.usage.rows, p.modelLabels),
  };
}

export function buildDimensions(w: PeriodWindow, p: DimensionInputs): { dimensions: DimensionsData; charts: Record<TabKey, ChartBreakdown> } {
  const nameOf = nameOfExperts(p.experts);
  const tabs: Record<TabKey, Dimension> = {
    ...filterableTabs(p, nameOf),
    skills: skillsTab(p.usage.skills, nameOf),
    mcp: mcpTab(p.usage.tools, nameOf),
    connectors: connectorsTab(p.usage.composio, p.connections, nameOf),
    deliverables: deliverablesTab(p.deliverables),
  };
  const each = <T>(f: (k: TabKey) => T): Record<TabKey, T> => ({
    experts: f("experts"),
    channels: f("channels"),
    routines: f("routines"),
    models: f("models"),
    skills: f("skills"),
    mcp: f("mcp"),
    connectors: f("connectors"),
    deliverables: f("deliverables"),
  });
  return { dimensions: each((k) => tabs[k].items), charts: each((k) => chartBreakdown(w, tabs[k])) };
}

/** Valeurs de chaque filtre : les lignes des onglets filtrables, sans filtre appliqué. */
export function buildFilterOptions(p: DimensionInputs): FilterOptions {
  const tabs = filterableTabs(p, nameOfExperts(p.experts));
  const options = (d: Dimension) => d.items.flatMap((i) => (i.filter ? [{ value: i.filter.value, name: i.name }] : []));
  return { experts: options(tabs.experts), channels: options(tabs.channels), routines: options(tabs.routines), models: options(tabs.models) };
}
