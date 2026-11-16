import type { SessionDims } from "../yele-mcp/types.ts";
import type { AnalyticsFilters, FilterDimension } from "./types.ts";

export const NO_FILTERS: AnalyticsFilters = { experts: [], channels: [], models: [], routines: [] };

export const FILTER_DIMENSIONS: readonly FilterDimension[] = ["experts", "channels", "models", "routines"];

/** Clé « profil/id » d'une routine. */
export const routineKey = (profile: string, routine: string): string => `${profile}/${routine}`;

/** Valeur d'une ligne pour chaque dimension de filtre. */
function valueOf(dims: SessionDims, dimension: FilterDimension): string {
  switch (dimension) {
    case "experts":
      return dims.profile;
    case "channels":
      return dims.source;
    case "models":
      return dims.model;
    case "routines":
      return dims.routine ? routineKey(dims.profile, dims.routine) : "";
  }
}

export const hasFilters = (f: AnalyticsFilters): boolean => FILTER_DIMENSIONS.some((d) => f[d].length > 0);

/** Indique si une ligne passe tous les filtres non vides. */
export function matchesFilters(dims: SessionDims, f: AnalyticsFilters): boolean {
  return FILTER_DIMENSIONS.every((d) => f[d].length === 0 || f[d].includes(valueOf(dims, d)));
}

/**
 * Indique si une ligne sans consommation, dont seules certaines dimensions sont connues, passe les
 * filtres : un filtre non vide portant sur une dimension inconnue l'écarte.
 */
export function matchesKnownDims(known: Partial<SessionDims>, f: AnalyticsFilters): boolean {
  const dims: SessionDims = { profile: "", source: "", model: "", routine: "", ...known };
  const isKnown: Record<FilterDimension, boolean> = {
    experts: known.profile !== undefined,
    channels: known.source !== undefined,
    models: known.model !== undefined,
    routines: known.routine !== undefined && known.profile !== undefined,
  };
  return FILTER_DIMENSIONS.every((d) => f[d].length === 0 || (isKnown[d] && f[d].includes(valueOf(dims, d))));
}
