import type { AnalyticsItem } from "./types.ts";

// Premiers caractères qu'un tableur interprète comme une formule ; la cellule est préfixée par « ' ».
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(v: string | number | null): string {
  if (v === null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const s = FORMULA_START.test(v) ? `'${v}` : v;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  // BOM UTF-8 en tête du fichier.
  return "﻿" + [headers, ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

/** En-têtes des colonnes de l'onglet, tels que le tableau les affiche ; `volume` est null sans colonne de volume. */
export interface CsvHeaders {
  share: string;
  volume: string | null;
  count: string;
}

const percentHeader = (label: string) => (label.includes("%") ? label : `${label} (%)`);

/** Les lignes de l'onglet ; une taille est exportée en octets. */
export function itemsCsv(items: AnalyticsItem[], headers: CsvHeaders): string {
  const inBytes = items.some((i) => i.volume?.unit === "octets");
  const volumeHeader = headers.volume === null ? [] : [inBytes ? `${headers.volume} (octets)` : headers.volume];
  return toCsv(
    ["Nom", "Détail", percentHeader(headers.share), ...volumeHeader, headers.count],
    items.map((i) => [i.name, i.subtitle ?? null, i.share, ...(headers.volume === null ? [] : [i.volume?.value ?? null]), i.count])
  );
}
