"use client";

import { useEffect, useMemo, useState } from "react";
import { Filter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FILTER_DIMENSIONS, hasFilters, NO_FILTERS } from "@/lib/analytics/filters";
import type { AnalyticsFilters, FilterDimension, FilterOptions } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";

export const FILTER_LABELS: Record<FilterDimension, string> = { experts: "Experts", channels: "Canaux", models: "Modèles", routines: "Routines" };

const count = (f: AnalyticsFilters) => FILTER_DIMENSIONS.reduce((n, d) => n + f[d].length, 0);

export function FiltersDialog({ options, value, onApply }: { options: FilterOptions; value: AnalyticsFilters; onApply: (f: AnalyticsFilters) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AnalyticsFilters>(value);
  const [dimension, setDimension] = useState<FilterDimension>("experts");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return options[dimension].filter((o) => !q || o.name.toLowerCase().includes(q));
  }, [options, dimension, search]);

  const toggle = (v: string) =>
    setDraft((d) => ({ ...d, [dimension]: d[dimension].includes(v) ? d[dimension].filter((x) => x !== v) : [...d[dimension], v] }));

  const apply = (f: AnalyticsFilters) => {
    onApply(f);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-[12px] border border-line bg-surface px-3 text-[13px] text-ink hover:bg-soft"
      >
        <Filter className="size-3.5 text-ink-3" />
        Filtres{hasFilters(value) ? ` (${count(value)})` : ""}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>Filtres</DialogTitle>
          <div className="flex min-h-[320px] gap-4">
            <nav className="flex w-36 shrink-0 flex-col gap-1">
              {FILTER_DIMENSIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setDimension(d);
                    setSearch("");
                  }}
                  className={cn("flex items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm", d === dimension ? "bg-soft font-semibold text-ink" : "text-ink-3 hover:text-ink")}
                >
                  {FILTER_LABELS[d]}
                  {draft[d].length > 0 && <span className="text-xs text-ink-3">{draft[d].length}</span>}
                </button>
              ))}
            </nav>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <label className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher"
                  className="w-full rounded-xl border border-line bg-soft/60 py-1.5 pl-8 pr-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand/40 focus:outline-none"
                />
              </label>
              <div className="max-h-72 flex-1 space-y-1 overflow-y-auto pr-1">
                {shown.length === 0 ? (
                  <p className="py-8 text-center text-sm text-ink-3">Aucune valeur</p>
                ) : (
                  shown.map((o) => (
                    <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm text-ink hover:bg-soft">
                      <input type="checkbox" checked={draft[dimension].includes(o.value)} onChange={() => toggle(o.value)} className="rounded text-brand" />
                      <span className="truncate">{o.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <Button variant="ghost" onClick={() => apply(NO_FILTERS)} disabled={!hasFilters(draft) && !hasFilters(value)}>
              Effacer les filtres
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button onClick={() => apply(draft)}>Appliquer</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ActiveFilters({ options, value, onChange }: { options: FilterOptions; value: AnalyticsFilters; onChange: (f: AnalyticsFilters) => void }) {
  if (!hasFilters(value)) return null;
  const nameOf = (d: FilterDimension, v: string) => options[d].find((o) => o.value === v)?.name ?? v;
  return (
    <div className="flex flex-wrap gap-2">
      {FILTER_DIMENSIONS.flatMap((d) =>
        value[d].map((v) => (
          <span key={`${d}:${v}`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink-2">
            <span className="text-ink-3">{FILTER_LABELS[d]} :</span> {nameOf(d, v)}
            <button
              type="button"
              aria-label={`Retirer ${nameOf(d, v)}`}
              onClick={() => onChange({ ...value, [d]: value[d].filter((x) => x !== v) })}
              className="text-ink-3 hover:text-ink"
            >
              <X className="size-3" />
            </button>
          </span>
        ))
      )}
    </div>
  );
}
