"use client";

import { Picker } from "@/components/ui/picker";
import type { AnalyticsPeriod, Granularity } from "@/lib/analytics/types";

const PERIODS: { value: AnalyticsPeriod; label: string }[] = [
  { value: "aujourdhui", label: "Aujourd'hui" },
  { value: "7_jours", label: "7 derniers jours" },
  { value: "30_jours", label: "30 derniers jours" },
  { value: "90_jours", label: "90 derniers jours" },
];

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: "jour", label: "Par jour" },
  { value: "semaine", label: "Par semaine" },
  { value: "mois", label: "Par mois" },
];

export function PeriodPicker({ value, onChange }: { value: AnalyticsPeriod; onChange: (p: AnalyticsPeriod) => void }) {
  return <Picker label="Période" placeholder="Période" value={value} onChange={(v) => onChange(v as AnalyticsPeriod)} groups={[{ options: PERIODS }]} />;
}

/** Regroupement de la courbe ; masqué pour « Aujourd'hui », découpé par heure. */
export function GranularityPicker({ period, value, onChange }: { period: AnalyticsPeriod; value: Granularity; onChange: (g: Granularity) => void }) {
  if (period === "aujourdhui") return null;
  return <Picker label="Regroupement" placeholder="Regroupement" value={value} onChange={(v) => onChange(v as Granularity)} groups={[{ options: GRANULARITIES }]} />;
}
