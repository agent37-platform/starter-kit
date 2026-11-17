import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyMetrics } from "../yele-mcp/session-usage/usage.ts";
import type { CallCountRow, InstanceSetup, SessionDims, SessionMetrics, SessionUsage, SessionUsageRow } from "../yele-mcp/types.ts";
import { chartBreakdown } from "./breakdown.ts";
import { computeAnalytics } from "./compute.ts";
import { NO_FILTERS } from "./filters.ts";
import { periodWindow } from "./period.ts";
import type { AnalyticsFilters, Dimension } from "./types.ts";

const NOW = Date.parse("2026-11-10T12:30:00Z");
const DAY = 86_400_000;

const dims = (profile: string, source: string, model: string, routine = ""): SessionDims => ({ profile, source, model, routine });
const row = (slot: string, d: SessionDims, m: Partial<SessionMetrics>): SessionUsageRow => ({ slot, ...d, ...emptyMetrics(), ...m });
const calls = (slot: string, d: SessionDims, name: string, n: number): CallCountRow => ({ slot, ...d, name, calls: n });

const KOFFI_APP = dims("koffi", "agent37-gateway", "default");
const KOFFI_ROUTINE = dims("koffi", "cron", "claude-opus-5-5", "bbb222");
const DJENEBA_ROUTINE = dims("djeneba", "cron", "claude-opus-5-5", "aaa111");
const YELE_TELEGRAM = dims("yele", "telegram", "default");
const DJENEBA_ONESHOT = dims("djeneba", "oneshot", "default");

const usage: SessionUsage = {
  rows: [
    // Aujourd'hui
    row("2026-11-10T09", KOFFI_APP, { sessions: 2, messages: 6, inputTokens: 100, outputTokens: 900, cacheReadTokens: 9_000 }),
    row("2026-11-10T09", DJENEBA_ROUTINE, { sessions: 1, messages: 2, outputTokens: 500, cacheReadTokens: 4_500 }),
    row("2026-11-10T11", KOFFI_ROUTINE, { sessions: 1, messages: 2, outputTokens: 1_000, cacheWriteTokens: 4_000 }),
    // Hier
    row("2026-11-09T21", YELE_TELEGRAM, { sessions: 1, messages: 4, outputTokens: 200, cacheWriteTokens: 1_800 }),
    // Plus de deux jours : un créneau par jour.
    row("2026-10-21", DJENEBA_ONESHOT, { sessions: 3, cacheReadTokens: 30_000 }),
    row("2026-10-01", KOFFI_ROUTINE, { sessions: 1, outputTokens: 9_000 }),
  ],
  totals: [],
  tools: [
    calls("2026-11-10T09", KOFFI_APP, "terminal", 4),
    calls("2026-11-10T09", DJENEBA_ROUTINE, "skill_view", 6),
    calls("2026-11-10T09", KOFFI_APP, "mcp__apps__COMPOSIO_MULTI_EXECUTE_TOOL", 3),
    calls("2026-11-09T21", DJENEBA_ROUTINE, "mcp__memoire__rechercher", 1),
    calls("2026-11-10T09", DJENEBA_ROUTINE, "mcp__apps__YELEMA_PREPARER_FICHIER", 1),
    calls("2026-10-21", DJENEBA_ONESHOT, "terminal", 10),
  ],
  skills: [
    calls("2026-11-10T09", DJENEBA_ROUTINE, "rendre-livrable", 4),
    calls("2026-11-10T09", KOFFI_APP, "rendre-livrable", 1),
    calls("2026-11-09T21", DJENEBA_ROUTINE, "borne-09/2-mon-metier/sections/data-room", 2),
  ],
  composio: [
    calls("2026-11-10T09", KOFFI_APP, "GOOGLESHEETS_BATCH_GET", 2),
    calls("2026-11-10T09", KOFFI_APP, "GOOGLE_MAPS_SEARCH", 1),
    calls("2026-11-09T21", DJENEBA_ROUTINE, "NOTION_SEARCH_NOTION_PAGE", 1),
  ],
  unreadable: [],
};

const setup: InstanceSetup = {
  profiles: {
    djeneba: {
      routines: [{ id: "aaa111", name: "Point du soir (Djénéba)", enabled: true, schedule: "0 17 * * 1-5" }],
      mcpServers: ["apps", "memoire"],
    },
    koffi: {
      routines: [
        { id: "bbb222", name: "Veille créative (Koffi)", enabled: false, schedule: "0 8 * * *" },
        { id: "ccc333", name: "Revue du lundi (Koffi)", enabled: true, schedule: "30 7 * * 1" },
        { id: "ddd444", name: "Proposée jamais activée (Koffi)", enabled: false, schedule: "0 9 * * *" },
      ],
      mcpServers: ["apps", "buffer"],
    },
  },
};

const connections = [
  { toolkitSlug: "googlesheets", toolkitName: "Google Sheets", status: "ACTIVE", isDisabled: false },
  { toolkitSlug: "google_maps", toolkitName: "Google Maps", status: "ACTIVE", isDisabled: false },
  { toolkitSlug: "gmail", toolkitName: "Gmail", status: "EXPIRED", isDisabled: false },
];

const channels = [
  { id: "telegram", name: "Telegram", enabled: true, configured: true, state: "connected" },
  { id: "slack", name: "Slack", enabled: true, configured: true, state: "connected" },
  { id: "whatsapp", name: "WhatsApp", enabled: true, configured: true, state: "startup_failed" },
  { id: "discord", name: "Discord", enabled: false, configured: true, state: null },
  { id: "api_server", name: "API Server", enabled: true, configured: true, state: "connected" },
];

const experts = [
  { id: "koffi", name: "Koffi", description: "Design & DA" },
  { id: "djeneba", name: "Djénéba", description: "Chief of Staff : agenda, notes de réunion" },
  { id: "awa", name: "Awa · Support", description: "Support" },
];

const files = [
  { name: "budget.xlsx", path: "Mamadou/budget.xlsx", size: 2_000, modified: NOW - 1_000 },
  { name: "rapport.pdf", path: "Djeneba/rapport.pdf", size: 5_000, modified: NOW - 2_000 },
  { name: "bilan.xlsx", path: "Mamadou/2026/bilan.xlsx", size: 3_000, modified: NOW - 3_000 },
  { name: "ancien.pdf", path: "Djeneba/ancien.pdf", size: 1_000, modified: NOW - 40 * DAY },
  { name: "sans-date.pdf", path: "sans-date.pdf", size: 1_000, modified: null },
];

const compute = (period: "aujourdhui" | "7_jours" | "30_jours" | "90_jours", over: Partial<Parameters<typeof computeAnalytics>[0]> = {}) =>
  computeAnalytics({
    usage,
    setup,
    connections,
    channels,
    experts,
    deliverables: files,
    modelLabels: { "claude-opus-5-5": "Claude Opus 5.5" },
    period,
    granularity: "jour",
    filters: NO_FILTERS,
    now: NOW,
    ...over,
  });
const withFilters = (f: Partial<AnalyticsFilters>) => compute("7_jours", { filters: { ...NO_FILTERS, ...f } });

test("periodWindow : heures pour aujourd'hui ; jours, semaines (du lundi) ou mois sinon", () => {
  const today = periodWindow("aujourdhui", NOW);
  assert.equal(today.buckets.length, 24);
  assert.equal(today.buckets[9].key, "2026-11-10T09");
  const week = periodWindow("7_jours", NOW);
  assert.deepEqual([week.fromDay, week.toDay, week.buckets.length], ["2026-11-04", "2026-11-10", 7]);
  assert.equal(week.bucketOf("2026-11-09T21"), "2026-11-09");
  assert.equal(periodWindow("90_jours", NOW).buckets.length, 90);
  const weeks = periodWindow("7_jours", NOW, "semaine");
  assert.deepEqual(weeks.buckets.map((b) => b.key), ["2026-11-02", "2026-11-09"]);
  assert.equal(weeks.bucketOf("2026-11-10T09"), "2026-11-09");
  const months = periodWindow("90_jours", NOW, "mois");
  assert.deepEqual(months.buckets.map((b) => b.key), ["2026-08", "2026-09", "2026-10", "2026-11"]);
  assert.equal(months.bucketOf("2026-10-21"), "2026-10");
});

test("totaux : toutes les sessions de la période, sur les quatre périodes", () => {
  const t = compute("aujourdhui").totals;
  assert.deepEqual([t.sessions, t.tokens, t.messages], [4, 20_000, 10]);
  assert.equal("costUsd" in t, false);
  assert.equal(compute("7_jours").totals.tokens, 22_000);
  assert.equal(compute("30_jours").totals.tokens, 52_000);
  assert.equal(compute("90_jours").totals.tokens, 61_000);
});

const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);

test("courbe : vrais tokens par tranche, experts actifs hors Yélé et profil principal, tranche en cours marquée", () => {
  const today = compute("aujourdhui");
  assert.deepEqual([sum(today.charts.experts.values[9]), sum(today.charts.experts.values[11])], [15_000, 5_000]);
  assert.equal(today.timeline[9].expertsActive, 2);
  assert.equal(today.timeline.findIndex((p) => p.partial), 12);
  const week = compute("7_jours");
  assert.deepEqual([sum(week.charts.experts.values[5]), sum(week.charts.experts.values[6])], [2_000, 20_000]);
  assert.deepEqual([week.timeline[5].expertsActive, week.timeline[6].expertsActive], [0, 2]);
  const months = compute("90_jours", { granularity: "mois" }).charts.experts.values.map(sum);
  assert.deepEqual(months, [0, 0, 39_000, 22_000]);
});

test("aujourd'hui : invocations et fichiers placés à leur heure dans la courbe", () => {
  const { charts } = compute("aujourdhui");
  assert.equal(sum(charts.skills.values[9]), 5);
  assert.equal(sum(charts.mcp.values[9]), 1);
  assert.equal(sum(charts.connectors.values[9]), 3);
  assert.deepEqual(charts.deliverables.values[12], [2, 1]);
  assert.equal(charts.skills.values.reduce((s, v) => s + sum(v), 0), 5);
});

test("courbe découpée selon l'onglet : séries des lignes de l'onglet, dans son unité", () => {
  const { charts } = compute("7_jours");
  assert.deepEqual(charts.experts.series.map((s) => s.id), ["koffi", "djeneba", "yele"]);
  assert.deepEqual(charts.experts.values[6], [15_000, 5_000, 0]);
  assert.deepEqual(charts.models.series.map((s) => s.name), ["Modèle par défaut de l'instance", "Claude Opus 5.5"]);
  assert.equal(charts.skills.unit, "invocations");
  assert.deepEqual(charts.skills.values[6], [5, 0]);
  assert.equal(charts.deliverables.unit, "fichiers");
  assert.deepEqual(charts.deliverables.values[6], [2, 1]);
});

test("chartBreakdown : 10 séries au plus, « Autres » compris ; toutes les lignes quand il y en a 10 ou moins", () => {
  const w = periodWindow("7_jours", NOW);
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, name: `E${i}`, iconKind: "expert", share: 0, volume: { value: 0, unit: "tokens" as const }, count: 0 }));
  const d: Dimension = { items, facts: items.map((it, i) => ({ slot: "2026-11-10", itemId: it.id, value: 20 - i })), unit: "tokens" };
  const c = chartBreakdown(w, d);
  assert.deepEqual(c.series.map((s) => s.id), ["e0", "e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "autres"]);
  assert.deepEqual(c.values[6], [20, 19, 18, 17, 16, 15, 14, 13, 12, 11 + 10 + 9]);
  const ten = chartBreakdown(w, { ...d, facts: d.facts.slice(0, 10) });
  assert.deepEqual(ten.series.map((s) => s.id), ["e0", "e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9"]);
  const few = chartBreakdown(w, { ...d, facts: d.facts.slice(0, 3) });
  assert.deepEqual(few.series.map((s) => s.id), ["e0", "e1", "e2"]);
});

test("experts : le plus gros consommateur d'abord, inactifs gardés, profil hors annuaire sous son id, Yélé marqué non-expert", () => {
  const res = compute("7_jours");
  assert.deepEqual(
    res.experts.map((e) => [e.id, e.name, e.tokens, e.messages, e.isActive, e.isExpert]),
    [
      ["koffi", "Koffi", 15_000, 8, true, true],
      ["djeneba", "Djénéba", 5_000, 2, true, true],
      ["yele", "Yélé", 2_000, 4, true, false],
      ["awa", "Awa · Support", 0, 0, false, true],
    ]
  );
  assert.equal(res.experts[0].tokensPercent, 68);
  assert.deepEqual([res.totals.activeExperts, res.totals.totalExperts], [2, 3]);
});

test("profil illisible : nommé dans les sources lues", () => {
  const res = compute("7_jours", { usage: { ...usage, unreadable: ["awa", "inconnu"] } });
  assert.deepEqual(res.readable.unreadableExperts, ["Awa · Support", "inconnu"]);
  assert.deepEqual(compute("7_jours").readable.unreadableExperts, []);
});

test("onglet Experts : titre seul sous le nom (absent s'il répète le nom), part, tokens et messages", () => {
  assert.deepEqual(
    compute("7_jours").dimensions.experts.map((e) => [e.name, e.subtitle, e.share, e.volume?.value, e.count]),
    [
      ["Koffi", "Design & DA", 68, 15_000, 8],
      ["Djénéba", "Chief of Staff", 23, 5_000, 2],
      ["Yélé", undefined, 9, 2_000, 4],
      ["Awa · Support", undefined, 0, 0, 0],
    ]
  );
});

test("onglets : canaux d'accès (sans activité : connectés seulement), modèles et compétences sous des noms lisibles, MCP hors Composio, connecteurs avec logo", () => {
  const d = compute("7_jours").dimensions;
  assert.deepEqual(
    d.channels.map((c) => [c.name, c.volume?.value, c.count, c.subtitle]),
    [
      ["Plateforme", 10_000, 6, undefined],
      ["Telegram", 2_000, 4, undefined],
      ["Slack", 0, 0, undefined],
    ]
  );
  assert.deepEqual(d.models.map((c) => [c.name, c.volume?.value, c.count, c.subtitle]), [
    ["Modèle par défaut de l'instance", 12_000, 10, undefined],
    ["Claude Opus 5.5", 10_000, 4, undefined],
  ]);
  assert.deepEqual(d.skills.map((s) => [s.name, s.count, s.subtitle]), [
    ["Rendre livrable", 5, "Djénéba et Koffi"],
    ["Data room", 2, "Djénéba"],
  ]);
  assert.deepEqual(d.mcp.map((m) => [m.name, m.count, m.subtitle]), [
    ["Memoire", 1, "Djénéba"],
    ["Apps", 1, "Djénéba"],
  ]);
  assert.deepEqual(d.connectors.map((c) => [c.name, c.count, c.subtitle]), [
    ["Google Sheets", 2, "1 compte connecté · Koffi"],
    ["Google Maps", 1, "1 compte connecté · Koffi"],
    ["Notion", 1, "Non connecté · Djénéba"],
  ]);
  assert.match(d.connectors[2].logo ?? "", /notion/);
  assert.deepEqual(d.deliverables.map((f) => [f.name, f.count, f.volume]), [
    ["Tableurs", 2, { value: 5_000, unit: "octets" }],
    ["PDF", 1, { value: 5_000, unit: "octets" }],
  ]);
  assert.ok(d.skills.every((s) => s.volume === null));
});

test("onglet Routines : consommation par routine, son expert et son horaire ; les actives sans exécution restent", () => {
  const r = compute("7_jours").dimensions.routines;
  assert.deepEqual(
    r.map((i) => [i.name, i.subtitle, i.volume?.value, i.count, i.filter?.value]),
    [
      ["Point du soir", "Djénéba · Chaque jour ouvré à 17 h", 5_000, 1, "djeneba/aaa111"],
      ["Veille créative", "Koffi · Chaque jour à 8 h · En pause", 5_000, 1, "koffi/bbb222"],
      ["Revue du lundi", "Koffi · Chaque lundi à 7 h 30", 0, 0, "koffi/ccc333"],
    ]
  );
});

test("filtres : appliqués ensemble aux totaux, à la courbe et à tous les onglets", () => {
  const koffi = withFilters({ experts: ["koffi"] });
  assert.equal(koffi.totals.tokens, 15_000);
  assert.deepEqual(koffi.experts.map((e) => e.id), ["koffi"]);
  assert.deepEqual(koffi.dimensions.skills.map((s) => [s.name, s.count]), [["Rendre livrable", 1]]);
  assert.deepEqual(koffi.dimensions.mcp, []);
  assert.equal(koffi.dimensions.connectors.reduce((s, c) => s + c.count, 0), 3);
  assert.deepEqual(koffi.filterOptions.experts.map((o) => o.value), ["koffi", "djeneba", "yele", "awa"]);

  const routine = withFilters({ routines: ["djeneba/aaa111"] });
  assert.equal(routine.totals.tokens, 5_000);
  assert.deepEqual(routine.dimensions.skills.map((s) => [s.name, s.count]), [["Rendre livrable", 4], ["Data room", 2]]);
  assert.deepEqual(routine.dimensions.mcp.map((m) => m.name), ["Memoire", "Apps"]);

  assert.equal(withFilters({ channels: ["telegram"] }).totals.tokens, 2_000);
  assert.equal(withFilters({ models: ["claude-opus-5-5"] }).totals.tokens, 10_000);
  assert.equal(withFilters({ experts: ["koffi"], models: ["default"] }).totals.tokens, 10_000);
});

test("filtres : les lignes sans consommation (routines actives, canaux connectés) ne passent que si leurs dimensions connues correspondent", () => {
  const koffi = withFilters({ experts: ["koffi"] });
  assert.deepEqual(koffi.dimensions.routines.map((r) => r.name), ["Veille créative", "Revue du lundi"]);
  assert.deepEqual(koffi.dimensions.channels.map((c) => c.name), ["Plateforme"]);
  assert.deepEqual(withFilters({ models: ["claude-opus-5-5"] }).dimensions.routines.map((r) => r.name), ["Point du soir", "Veille créative"]);
  assert.deepEqual(withFilters({ channels: ["slack"] }).dimensions.channels.map((c) => [c.name, c.subtitle]), [["Slack", undefined]]);
  assert.deepEqual(withFilters({ channels: ["whatsapp"] }).dimensions.channels, []);
});

test("onglet Compétences : deux noms qui s'affichent pareil sont une seule ligne", () => {
  const extra = { ...usage, skills: [...usage.skills, calls("2026-11-10T09", KOFFI_APP, "borne-01/rendre-livrable", 3)] };
  assert.deepEqual(compute("7_jours", { usage: extra }).dimensions.skills.map((s) => [s.name, s.count]), [
    ["Rendre livrable", 8],
    ["Data room", 2],
  ]);
});

test("configuration lue en partie : routines d'un profil illisible sous leur id, sans « Supprimée »", () => {
  const partial: InstanceSetup = { profiles: { djeneba: { routines: null, mcpServers: null }, koffi: setup.profiles.koffi } };
  const r = compute("7_jours", { setup: partial }).dimensions.routines;
  assert.deepEqual(r.map((i) => [i.name, i.subtitle]), [
    ["Routine aaa111", "Djénéba"],
    ["Veille créative", "Koffi · Chaque jour à 8 h · En pause"],
    ["Revue du lundi", "Koffi · Chaque lundi à 7 h 30"],
  ]);
});

test("sources illisibles : drapeaux à faux, aucune ligne inventée", () => {
  const res = compute("7_jours", { usage: null, setup: null, connections: null, channels: null, deliverables: null, experts: null, modelLabels: null });
  assert.deepEqual(res.readable, { usage: false, deliverables: false, unreadableExperts: [] });
  assert.equal(res.totals.tokens, 0);
  for (const items of Object.values(res.dimensions)) assert.deepEqual(items, []);
  assert.deepEqual(compute("7_jours", { usage: null }).experts.map((e) => e.id), ["awa", "djeneba", "koffi"]);
});
