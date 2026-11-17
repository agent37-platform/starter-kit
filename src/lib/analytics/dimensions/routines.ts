import { scheduleLabel } from "../../routines.ts";
import { SESSION_SOURCES } from "../../yele-mcp/hermes-layout.ts";
import { masquerSecrets } from "../../yele-mcp/secrets.ts";
import type { InstanceSetup, RoutineDefinition, SessionUsageRow } from "../../yele-mcp/types.ts";
import { routineKey } from "../filters.ts";
import type { AnalyticsItem, Dimension } from "../types.ts";
import { consumptionDimension } from "./consumption.ts";

/** Nom de la routine sans le suffixe « (Expert) ». */
export function routineName(name: string, expert: string): string {
  const suffix = ` (${expert})`;
  return name.toLowerCase().endsWith(suffix.toLowerCase()) ? name.slice(0, -suffix.length).trim() : name;
}

function routineItem(
  key: string,
  def: RoutineDefinition | undefined,
  known: boolean,
  nameOf: (profile: string) => string,
  figures: { share: number; tokens: number; count: number }
): AnalyticsItem {
  const [profile, id] = key.split("/");
  const expert = nameOf(profile);
  const detail = def ? [expert, scheduleLabel(def.schedule), def.enabled ? null : "En pause"] : [expert, known ? "Supprimée" : null];
  return {
    id: `routine_${key}`,
    name: def ? masquerSecrets(routineName(def.name, expert)) || id : `Routine ${id}`,
    subtitle: detail.filter(Boolean).join(" · "),
    iconKind: SESSION_SOURCES.routine,
    filter: { dimension: "routines", value: key },
    share: figures.share,
    volume: { value: figures.tokens, unit: "tokens" },
    count: figures.count,
  };
}

/** `keepIdle` : indique si une routine active sans exécution sur la période est listée. */
export function routinesTab(
  rows: SessionUsageRow[],
  setup: InstanceSetup | null,
  nameOf: (profile: string) => string,
  keepIdle: (profile: string, routine: string) => boolean
): Dimension {
  const definitions = new Map<string, RoutineDefinition>();
  for (const [profile, p] of Object.entries(setup?.profiles ?? {})) for (const r of p.routines ?? []) definitions.set(routineKey(profile, r.id), r);
  const known = (key: string) => Array.isArray(setup?.profiles[key.split("/")[0]]?.routines);

  const used = consumptionDimension(
    rows.filter((r) => r.routine),
    (r) => routineKey(r.profile, r.routine),
    (key, t, share) => routineItem(key, definitions.get(key), known(key), nameOf, { share, tokens: t.tokens, count: t.sessions })
  );
  const seen = new Set(used.items.map((i) => i.id));
  const idle = [...definitions]
    .filter(([key, r]) => r.enabled && !seen.has(`routine_${key}`) && keepIdle(key.split("/")[0], r.id))
    .map(([key, r]) => routineItem(key, r, true, nameOf, { share: 0, tokens: 0, count: 0 }));
  const items = [...used.items, ...idle].sort((a, b) => (b.volume?.value ?? 0) - (a.volume?.value ?? 0) || b.count - a.count || a.name.localeCompare(b.name, "fr"));
  return { ...used, items };
}
