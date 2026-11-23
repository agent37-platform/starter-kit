"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, Filter, Search } from "lucide-react";
import { itemsCsv } from "@/lib/analytics/csv";
import { hasFilters } from "@/lib/analytics/filters";
import { formatBytes, formatWhole } from "@/lib/analytics/format";
import type { AnalyticsItem, AnalyticsOverview, Readable, TabKey } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";
import { useExpertsContext } from "@/components/experts/ExpertsProvider";
import { YELE_FACE } from "@/components/yele/YelePortrait";
import { isCompanionProfile } from "@/lib/companion";
import { expertColors } from "./colors";
import { DimensionIcon } from "./DimensionIcon";

type SortKey = "share" | "volume" | "count";

interface Sort {
  key: SortKey;
  asc: boolean;
}

interface Tab {
  key: TabKey;
  label: string;
  share: string;
  /** En-tête de la colonne de volume ; null si l'onglet n'en a pas. */
  volume: string | null;
  count: string;
  /** Source lue dont viennent les lignes de l'onglet. */
  source: keyof Readable;
  /** Indique si les filtres de la page s'appliquent à l'onglet. */
  filterable: boolean;
}

export const TABS: Tab[] = [
  { key: "experts", label: "Experts", share: "Consommation", volume: "Tokens", count: "Messages", source: "usage", filterable: true },
  { key: "channels", label: "Canaux", share: "Consommation", volume: "Tokens", count: "Messages", source: "usage", filterable: true },
  { key: "routines", label: "Routines", share: "Consommation", volume: "Tokens", count: "Exécutions", source: "usage", filterable: true },
  { key: "models", label: "Modèles", share: "Consommation", volume: "Tokens", count: "Messages", source: "usage", filterable: true },
  { key: "skills", label: "Compétences", share: "Consommation", volume: null, count: "Invocations", source: "usage", filterable: true },
  { key: "mcp", label: "MCP", share: "Consommation", volume: null, count: "Invocations", source: "usage", filterable: true },
  { key: "connectors", label: "Connecteurs", share: "Consommation", volume: null, count: "Invocations", source: "usage", filterable: true },
  { key: "deliverables", label: "Livrables", share: "Fichiers (%)", volume: "Taille", count: "Fichiers", source: "deliverables", filterable: false },
];

/** Onglets affichés : ceux auxquels s'appliquent les filtres quand il y en a. */
export const visibleTabs = (data: AnalyticsOverview): Tab[] => (hasFilters(data.filters) ? TABS.filter((t) => t.filterable) : TABS);

const sortValue = (i: AnalyticsItem, k: SortKey): number =>
  k === "share" ? i.share : k === "volume" ? i.volume?.value ?? -1 : i.count;

/** Colonnes triables de l'onglet ; la première est son tri par défaut. */
const sortKeys = (t: Tab): SortKey[] => [...(t.volume ? (["volume"] as const) : []), "count", "share"];

/** Tri appliqué à l'onglet : celui choisi s'il porte sur une de ses colonnes, sinon sa mesure principale, décroissante. */
const sortFor = (t: Tab, chosen: Sort | null): Sort => (chosen && sortKeys(t).includes(chosen.key) ? chosen : { key: sortKeys(t)[0], asc: false });

const CELL = "px-2 py-3 sm:px-4";

// Profil client__expert : la clé du catalogue est ce qui suit le dernier « __ » (comme catalogueKeyOf).
const catalogueKeyOf = (profileId: string): string => (profileId.includes("__") ? profileId.slice(profileId.lastIndexOf("__") + 2) : profileId);

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export function DimensionsTable({
  data,
  tab,
  onTab,
  onFilter,
}: {
  data: AnalyticsOverview;
  tab: TabKey;
  onTab: (t: TabKey) => void;
  onFilter: (f: NonNullable<AnalyticsItem["filter"]>) => void;
}) {
  const [search, setSearch] = useState("");
  const [chosenSort, setSort] = useState<Sort | null>(null);
  const tabs = visibleTabs(data);
  const config = tabs.find((t) => t.key === tab) ?? tabs[0];
  const sort = sortFor(config, chosenSort);
  const readable = data.readable[config.source];
  const columns = 4 + (config.volume ? 1 : 0);
  const expertColor = useMemo(() => expertColors(data.charts.experts), [data.charts.experts]);
  // Photos des Experts de l'espace, par profil (clé du catalogue en second recours).
  const { experts } = useExpertsContext();
  const photoOf = useMemo(() => {
    const byProfile = new Map<string, string>();
    const byKey = new Map<string, string>();
    for (const e of experts) {
      if (!e.photoUrl) continue;
      byProfile.set(e.profileId, e.photoUrl);
      byKey.set(catalogueKeyOf(e.profileId), e.photoUrl);
    }
    // Yélé n'est pas au catalogue des Experts : son visage fixe (WebP de 5 Ko, celui des appels).
    return (id: string) => (isCompanionProfile(catalogueKeyOf(id)) ? YELE_FACE : byProfile.get(id) ?? byKey.get(catalogueKeyOf(id)) ?? null);
  }, [experts]);
  const isActive = (f: AnalyticsItem["filter"]) => !!f && data.filters[f.dimension].includes(f.value);

  const items = useMemo(() => {
    if (!readable) return [];
    const q = search.trim().toLowerCase();
    const list = data.dimensions[config.key].filter((i) => !q || `${i.name} ${i.subtitle ?? ""}`.toLowerCase().includes(q));
    return list.sort((a, b) => {
      const cmp = sortValue(a, sort.key) - sortValue(b, sort.key);
      return (sort.asc ? cmp : -cmp) || a.name.localeCompare(b.name, "fr");
    });
  }, [readable, data.dimensions, config.key, search, sort.key, sort.asc]);

  const header = (key: SortKey, label: string, align: "left" | "right", width: string) => {
    const active = sort.key === key;
    const Icon = !active ? ChevronsUpDown : sort.asc ? ArrowUp : ArrowDown;
    return (
      <th aria-sort={active ? (sort.asc ? "ascending" : "descending") : "none"} className={cn(CELL, width, "font-semibold", align === "right" && "text-right")}>
        <button
          type="button"
          onClick={() => setSort({ key, asc: active ? !sort.asc : false })}
          className={cn("inline-flex items-center gap-1.5 text-ink hover:text-ink-2", align === "right" && "justify-end text-right")}
        >
          {label}
          <Icon className={cn("size-3.5 shrink-0", active ? "text-ink" : "text-ink-3")} />
        </button>
      </th>
    );
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-ink">Répartition</h2>
        <button
          type="button"
          disabled={items.length === 0}
          onClick={() => download(`yelema_${config.key}_${data.period}.csv`, itemsCsv(items, { share: config.share, volume: config.volume, count: config.count }))}
          className="inline-flex h-9 items-center gap-2 rounded-[12px] border border-line bg-surface px-3.5 text-[13px] font-bold text-ink shadow-2xs hover:bg-soft disabled:opacity-40"
        >
          <Download className="size-3.5" />
          Télécharger les données
        </button>
      </div>

      <div className="rounded-[22px] border border-line bg-surface shadow-xs">
        <div className="space-y-4 px-4 pb-2 pt-2 sm:px-6">
          <div role="tablist" className="-mx-1 flex flex-wrap gap-x-1 border-b border-line">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={config.key === t.key}
                onClick={() => onTab(t.key)}
                className={cn(
                  "relative whitespace-nowrap px-3 py-3 text-sm font-semibold transition-colors",
                  config.key === t.key
                    ? "text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-ink"
                    : "text-ink-3 hover:text-ink"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <label className="relative block">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher…"
              aria-label="Rechercher"
              className="w-full rounded-xl border border-line bg-transparent py-2.5 pl-4 pr-10 text-sm text-ink placeholder:text-ink-3 focus:border-ink-3 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
            />
            <Search className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          </label>
        </div>

        <div className="sm:px-2">
          <table className="w-full table-fixed text-left text-xs">
            <thead className="text-sm">
              <tr className="border-b border-line">
                <th className={cn(CELL, "font-semibold text-ink")}>Nom</th>
                {header("share", config.share, "left", "hidden sm:table-cell sm:w-48")}
                {config.volume && header("volume", config.volume, "right", "w-24 sm:w-32")}
                {header("count", config.count, "right", "w-24 sm:w-32")}
                <th className="w-9 sm:w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={columns} className="py-12 text-center text-sm text-ink-3">
                    {!readable ? "Illisible" : search ? `Aucun résultat pour « ${search} »` : "Aucune activité"}
                  </td>
                </tr>
              ) : (
                items.map((i) => (
                  <tr key={i.id} className="hover:bg-soft/40">
                    <td className={CELL}>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <DimensionIcon item={i} color={i.iconKind === "expert" ? expertColor(i.id) : undefined} photo={i.iconKind === "expert" ? photoOf(i.id) : undefined} />
                        <div className="min-w-0 [overflow-wrap:anywhere]">
                          <p className="font-semibold text-ink">{i.name}</p>
                          {i.subtitle && <p className="text-[11px] text-ink-3">{i.subtitle}</p>}
                        </div>
                      </div>
                    </td>
                    <td className={cn(CELL, "hidden sm:table-cell")}>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-soft">
                          <div className="h-full rounded-full bg-brand" style={{ width: `${i.share}%`, backgroundColor: i.iconKind === "expert" ? expertColor(i.id) : undefined }} />
                        </div>
                        <span className="w-10 shrink-0 text-right tabular-nums text-ink-2">{i.share} %</span>
                      </div>
                    </td>
                    {config.volume && (
                      <td className={cn(CELL, "text-right font-semibold tabular-nums text-ink")}>
                        {i.volume === null ? "—" : i.volume.unit === "octets" ? formatBytes(i.volume.value) : formatWhole(i.volume.value)}
                      </td>
                    )}
                    <td className={cn(CELL, "text-right tabular-nums text-ink-2")}>{formatWhole(i.count)}</td>
                    <td className="py-3 pr-1 sm:pr-2">
                      {i.filter && (
                        <button
                          type="button"
                          aria-label={`Filtrer sur ${i.name}`}
                          aria-pressed={isActive(i.filter)}
                          onClick={() => onFilter(i.filter!)}
                          className={cn("rounded-md p-1.5 hover:bg-soft", isActive(i.filter) ? "text-brand" : "text-ink-3 hover:text-ink")}
                        >
                          <Filter className="size-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
