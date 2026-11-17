import { FILTER_DIMENSIONS, NO_FILTERS } from "./filters.ts";
import type { AnalyticsFilters, AnalyticsPeriod, Granularity } from "./types.ts";

export interface AnalyticsQuery {
  period: AnalyticsPeriod;
  granularity: Granularity;
  filters: AnalyticsFilters;
}

export const PERIODS: readonly AnalyticsPeriod[] = ["aujourdhui", "7_jours", "30_jours", "90_jours"];
export const GRANULARITIES: readonly Granularity[] = ["jour", "semaine", "mois"];
export const DEFAULT_QUERY: AnalyticsQuery = { period: "30_jours", granularity: "jour", filters: NO_FILTERS };

/** Nombre maximal de valeurs par filtre et longueur maximale d'une valeur. */
const MAX_VALUES = 50;
const MAX_LENGTH = 200;
const VALUE = /^[^\u0000-\u001f,]+$/;

const oneOf = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);

function values(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(","))].filter((v) => v.length <= MAX_LENGTH && VALUE.test(v)).slice(0, MAX_VALUES);
}

export function parseQuery(params: URLSearchParams): AnalyticsQuery {
  return {
    period: oneOf(params.get("period"), PERIODS, DEFAULT_QUERY.period),
    granularity: oneOf(params.get("granularity"), GRANULARITIES, DEFAULT_QUERY.granularity),
    filters: {
      experts: values(params.get("experts")),
      channels: values(params.get("channels")),
      models: values(params.get("models")),
      routines: values(params.get("routines")),
    },
  };
}

export function queryString(q: AnalyticsQuery): string {
  const params = new URLSearchParams({ period: q.period, granularity: q.granularity });
  for (const d of FILTER_DIMENSIONS) if (q.filters[d].length > 0) params.set(d, q.filters[d].join(","));
  return params.toString();
}
