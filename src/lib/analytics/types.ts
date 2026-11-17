import type { DocKind } from "../drive-links.ts";
import type { ChannelState, DiscoveredExpert, InstanceSetup, RawConnectionInfo, RawFileInfo, SessionUsage } from "../yele-mcp/types.ts";

export type AnalyticsPeriod = "aujourdhui" | "7_jours" | "30_jours" | "90_jours";
export type Granularity = "jour" | "semaine" | "mois";

/** Filtres de la page ; une liste vide ne filtre pas. `routines` contient des clés « profil/id ». */
export interface AnalyticsFilters {
  experts: string[];
  channels: string[];
  models: string[];
  routines: string[];
}

export type FilterDimension = keyof AnalyticsFilters;

export interface FilterOption {
  value: string;
  name: string;
}

/** Valeurs proposées pour chaque filtre : celles présentes sur la période, sans filtre. */
export type FilterOptions = Record<FilterDimension, FilterOption[]>;

export interface UsageTotals {
  sessions: number;
  messages: number;
  tokens: number;
}

/** Un point de la courbe : une heure, un jour, une semaine ou un mois UTC. */
export interface TimeSeriesPoint {
  key: string;
  label: string;
  /** Indique si le point contient l'instant présent. */
  partial: boolean;
  /** Experts (hors `NOT_EXPERTS`) ayant consommé sur le point. */
  expertsActive: number;
}

export interface ExpertMetric {
  id: string;
  name: string;
  role: string;
  messages: number;
  tokens: number;
  tokensPercent: number;
  /** Indique si le profil a consommé sur la période. */
  isActive: boolean;
  /** Faux pour les profils de `NOT_EXPERTS` (profil principal, Yélé). */
  isExpert: boolean;
}

export interface DeliverableSummary {
  size: number | null;
  modified: number | null;
  kind: DocKind;
}

export type VolumeUnit = "tokens" | "octets";

/** Une ligne d'onglet ; `volume` est null si l'onglet n'a pas de colonne de volume. */
export interface AnalyticsItem {
  id: string;
  name: string;
  subtitle?: string;
  /** Type de la ligne (expert, canal, modèle…), qui choisit son icône. */
  iconKind: string;
  logo?: string;
  /** Filtre appliqué par l'icône de filtre de la ligne. */
  filter?: { dimension: FilterDimension; value: string };
  share: number;
  volume: { value: number; unit: VolumeUnit } | null;
  count: number;
}

export type ChartUnit = "tokens" | "invocations" | "fichiers";

/** Valeur d'un fait d'onglet sur un créneau, attribuée à une ligne de l'onglet. */
export interface DimensionFact {
  slot: string;
  itemId: string;
  value: number;
}

/** Un onglet : ses lignes, et les faits qui découpent la courbe dans son unité. */
export interface Dimension {
  items: AnalyticsItem[];
  facts: DimensionFact[];
  unit: ChartUnit;
}

export interface ChartSeries {
  id: string;
  name: string;
}

/** Découpage de la courbe pour un onglet : `values[i][j]` est la valeur du point i pour la série j. */
export interface ChartBreakdown {
  unit: ChartUnit;
  series: ChartSeries[];
  values: number[][];
}

export interface DimensionsData {
  experts: AnalyticsItem[];
  channels: AnalyticsItem[];
  routines: AnalyticsItem[];
  models: AnalyticsItem[];
  skills: AnalyticsItem[];
  mcp: AnalyticsItem[];
  connectors: AnalyticsItem[];
  deliverables: AnalyticsItem[];
}

export type TabKey = keyof DimensionsData;

export interface Readable {
  usage: boolean;
  deliverables: boolean;
  /** Noms des experts dont les sessions sont illisibles, absents des chiffres. */
  unreadableExperts: string[];
}

export interface AnalyticsOverview {
  period: AnalyticsPeriod;
  granularity: Granularity;
  filters: AnalyticsFilters;
  filterOptions: FilterOptions;
  /** Début et fin de la période, en ISO. */
  from: string;
  to: string;
  readable: Readable;
  /** `activeExperts` et `totalExperts` ne comptent pas les profils de `NOT_EXPERTS`. */
  totals: UsageTotals & { activeExperts: number; totalExperts: number };
  timeline: TimeSeriesPoint[];
  charts: Record<TabKey, ChartBreakdown>;
  /** Du plus gros au plus petit consommateur. */
  experts: ExpertMetric[];
  dimensions: DimensionsData;
}

/** Entrées du calcul ; une source à null n'a pas pu être lue. */
export interface ComputeAnalyticsParams {
  usage: SessionUsage | null;
  setup: InstanceSetup | null;
  connections: RawConnectionInfo[] | null;
  channels: ChannelState[] | null;
  experts: DiscoveredExpert[] | null;
  deliverables: RawFileInfo[] | null;
  /** Id de modèle → libellé. */
  modelLabels: Record<string, string> | null;
  period: AnalyticsPeriod;
  granularity: Granularity;
  filters: AnalyticsFilters;
  now: number;
}
