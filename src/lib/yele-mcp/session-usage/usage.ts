import type {
  CallCountRow,
  ChannelUsage,
  ExpertUsageData,
  SessionDims,
  SessionMetrics,
  SessionUsage,
  SessionUsageRow,
  UsageByDay,
} from "../types.ts";

/** Ordre des chiffres dans chaque ligne renvoyée par le lecteur. */
export const METRIC_KEYS = [
  "sessions",
  "messages",
  "toolCalls",
  "apiCalls",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
  "durationMs",
] as const satisfies readonly (keyof SessionMetrics)[];

export function emptyMetrics(): SessionMetrics {
  return Object.fromEntries(METRIC_KEYS.map((k) => [k, 0])) as unknown as SessionMetrics;
}

export function addMetrics(acc: SessionMetrics, m: SessionMetrics): SessionMetrics {
  for (const k of METRIC_KEYS) acc[k] += m[k];
  return acc;
}

/** Tokens totaux : entrée, sortie, cache lu et cache écrit. */
export function tokensOf(m: SessionMetrics): number {
  return m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheWriteTokens;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function metricsAt(cells: unknown[], at: number): SessionMetrics {
  const m = emptyMetrics();
  METRIC_KEYS.forEach((k, i) => (m[k] = num(cells[at + i])));
  return m;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const table = (v: unknown): unknown[][] => (Array.isArray(v) ? v.filter(Array.isArray) : []);

/** Dimensions profil, canal, modèle, routine lues à partir de la cellule `at`. */
const dimsAt = (r: unknown[], at: number): SessionDims => ({ profile: str(r[at]), source: str(r[at + 1]), model: str(r[at + 2]), routine: str(r[at + 3]) });

const callCounts = (v: unknown): CallCountRow[] => table(v).map((r) => ({ slot: str(r[0]), ...dimsAt(r, 1), name: str(r[5]), calls: num(r[6]) }));

/** Valide le résultat du lecteur ; lève une exception si sa forme est inattendue. */
export function parseSessionUsage(stdout: string): SessionUsage {
  const raw = JSON.parse(stdout) as Record<string, unknown>;
  if (!Array.isArray(raw.rows) || !Array.isArray(raw.totals)) throw new Error("sortie inattendue");
  return {
    rows: table(raw.rows).map((r): SessionUsageRow => ({ slot: str(r[0]), ...dimsAt(r, 1), ...metricsAt(r, 5) })),
    totals: table(raw.totals).map((r): SessionUsageRow => ({ slot: "", ...dimsAt(r, 0), ...metricsAt(r, 4) })),
    tools: callCounts(raw.tools),
    skills: callCounts(raw.skills),
    composio: callCounts(raw.composio),
    unreadable: Array.isArray(raw.unreadable) ? raw.unreadable.filter((p): p is string => typeof p === "string") : [],
  };
}

export function emptyUsage(): ExpertUsageData {
  return {
    count: 0,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalDurationMs: 0,
    errors: 0,
    models: {},
    modelTokens: {},
    sources: {},
    messages: 0,
    toolCalls: 0,
  };
}

function addChannel(acc: Record<string, ChannelUsage>, key: string, c: ChannelUsage): void {
  const cur = (acc[key] ??= { sessions: 0, tokens: 0 });
  cur.sessions += c.sessions;
  cur.tokens += c.tokens;
}

/** Ajoute une ligne de sessions à la consommation d'un expert. */
export function addRow(u: ExpertUsageData, r: SessionUsageRow): ExpertUsageData {
  const tokens = tokensOf(r);
  u.count += r.sessions;
  u.totalTokens += tokens;
  u.promptTokens += r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens;
  u.completionTokens += r.outputTokens;
  u.totalDurationMs = (u.totalDurationMs ?? 0) + r.durationMs;
  u.messages = (u.messages ?? 0) + r.messages;
  u.toolCalls = (u.toolCalls ?? 0) + r.toolCalls;
  if (r.sessions > 0) u.models![r.model] = (u.models![r.model] ?? 0) + r.sessions;
  u.modelTokens![r.model] = (u.modelTokens![r.model] ?? 0) + tokens;
  addChannel((u.sources ??= {}), r.source, { sessions: r.sessions, tokens });
  return u;
}

export function addUsage(acc: ExpertUsageData, u: ExpertUsageData): ExpertUsageData {
  acc.count += u.count;
  acc.totalTokens += u.totalTokens;
  acc.promptTokens += u.promptTokens;
  acc.completionTokens += u.completionTokens;
  acc.totalDurationMs = (acc.totalDurationMs ?? 0) + (u.totalDurationMs ?? 0);
  acc.errors += u.errors;
  acc.messages = (acc.messages ?? 0) + (u.messages ?? 0);
  acc.toolCalls = (acc.toolCalls ?? 0) + (u.toolCalls ?? 0);
  for (const [m, n] of Object.entries(u.models ?? {})) acc.models![m] = (acc.models![m] ?? 0) + n;
  for (const [m, n] of Object.entries(u.modelTokens ?? {})) acc.modelTokens![m] = (acc.modelTokens![m] ?? 0) + n;
  for (const [s, c] of Object.entries(u.sources ?? {})) addChannel((acc.sources ??= {}), s, c);
  return acc;
}

export function usageByProfile(rows: SessionUsageRow[]): Record<string, ExpertUsageData> {
  const out: Record<string, ExpertUsageData> = {};
  for (const r of rows) addRow((out[r.profile] ??= emptyUsage()), r);
  return out;
}

/** Consommation par jour UTC puis par profil. */
export function usageByDayOf(rows: SessionUsageRow[]): UsageByDay {
  const out: UsageByDay = {};
  for (const r of rows) addRow(((out[r.slot.slice(0, 10)] ??= {})[r.profile] ??= emptyUsage()), r);
  return out;
}

/** Renseigne `errors` de chaque profil avec le nombre de routines en échec. */
export function withRoutineErrors(
  usage: Record<string, ExpertUsageData>,
  errors: Record<string, number> | null | undefined
): Record<string, ExpertUsageData> {
  for (const [profile, n] of Object.entries(errors ?? {})) if (usage[profile]) usage[profile].errors = n;
  return usage;
}
