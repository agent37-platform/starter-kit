import assert from "node:assert/strict";
import { test } from "node:test";
import { createYeleSupervisionBackend } from "./backend.ts";
import { formatActiviteExperts, formatStatistiquesAnalytique } from "./formatters/activity.ts";
import { formatAlertesEtIncidents } from "./formatters/alerts.ts";
import { formatCanauxEtTelegram } from "./formatters/channels.ts";
import { formatDiagnosticConfiguration } from "./formatters/config.ts";
import { formatAuditOutils } from "./formatters/connectors.ts";
import { formatConsommationTokens } from "./formatters/consumption.ts";
import { formatLivrablesRecents } from "./formatters/deliverables.ts";
import { formatRechercheMemoire } from "./formatters/memory.ts";
import { formatHistoriqueRoutines, formatRoutinesPlanning } from "./formatters/routines.ts";
import { formatSkillsExperts } from "./formatters/skills.ts";
import { formatAppelsEtVoix } from "./formatters/voice.ts";
import { periodDays, usageForPeriod } from "./periods.ts";
import { masquerSecrets } from "./secrets.ts";
import type { DiscoveredExpert, RawSessionInfo } from "./types.ts";

test("masquerSecrets: hides API keys, tokens, and passwords without leaking", () => {
  const sensitive = `
    ANTHROPIC_API_KEY: sk-ant-api03-abcdef1234567890abcdef1234567890-test
    TELEGRAM_BOT_TOKEN: 1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ123456789
    Authorization: Bearer mySecretToken1234567890abcdef
    client_secret: "superSecretPassword123"
  `;

  const masked = masquerSecrets(sensitive);

  assert.doesNotMatch(masked, /sk-ant-api03/);
  assert.doesNotMatch(masked, /1234567890:ABCdef/);
  assert.doesNotMatch(masked, /mySecretToken1234567890/);
  assert.doesNotMatch(masked, /superSecretPassword123/);

  assert.match(masked, /\[MASQUÉ\]/);
  assert.match(masked, /\[TOKEN_MASQUÉ\]/);
});

test("masquerSecrets: hides OpenRouter, OpenAI, sk_live_, Slack, GitHub, Google and AWS keys, a token ending in '-', any URL password", () => {
  const secrets = [
    "sk-or-v1-0123456789abcdef0123456789abcdef",
    "sk-abcdefghijklmnop1234",
    "sk_live_AbC123dEf456GhI789",
    "xoxb-123456789012-abcdefghijkl",
    "ghp_abcdefghijklmnopqrstuvwxyz0123",
    "AIzaSyA0123456789abcdefghijklmnopqrstuv",
    "AKIAABCDEFGHIJKLMNOP",
    "123456789:abcdefghijklmnopqrstuvwxyz01234567-",
  ];
  const masked = masquerSecrets(`erreur : ${secrets.join(" puis ")} ; mysql://root:hunter2pass@db:3306/x`);
  for (const s of secrets) assert.ok(!masked.includes(s), `non masqué : ${s}`);
  assert.doesNotMatch(masked, /hunter2pass/);
  assert.match(masquerSecrets("Coût du skill-builder sk-learn pour la réunion"), /skill-builder sk-learn/);
});

test("masquerSecrets: hides JWTs and Postgres connection strings", () => {
  const text =
    "postgres://myuser:secretPassword123@db.example.com:5432/mydb and eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSignatureValue123";
  const masked = masquerSecrets(text);
  assert.doesNotMatch(masked, /secretPassword123/);
  assert.doesNotMatch(masked, /doNotLeakThisSignatureValue123/);
  assert.match(masked, /\[MOT_DE_PASSE_MASQUÉ\]/);
  assert.match(masked, /\[JWT_MASQUÉ\]/);
});

test("formatActiviteExperts: dynamiquement avec liste d'experts découverts", () => {
  const now = 1730000000000;
  const experts: DiscoveredExpert[] = [
    { id: "fatima", name: "Fatima", description: "Marketing et contenu : campagnes, création de contenu..." },
    { id: "kouassi", name: "Kouassi", description: "Commercial et ventes : pipeline, prospection..." },
    { id: "adjoua", name: "Adjoua", description: "Recrutement : sourcing, tri de candidatures..." },
  ];
  const sessions: RawSessionInfo[] = [
    { id: "s1", profile: "fatima", last_active: now - 3600000 },
    { id: "s2", profile: "kouassi", last_active: now - 7200000 },
  ];

  const out = formatActiviteExperts(sessions, "aujourdhui", experts, now);
  assert.match(out, /Fatima \(Marketing et contenu\)/);
  assert.match(out, /Kouassi \(Commercial et ventes\)/);
  assert.match(out, /Experts inactifs \(1\)/);
  assert.match(out, /Adjoua \(Recrutement\)/);
});

test("formatActiviteExperts: repli dynamique si experts non fournis (découverte par sessions)", () => {
  const now = 1730000000000;
  const sessions: RawSessionInfo[] = [
    { id: "s1", profile: "djeneba", last_active: now - 1000 },
  ];

  const out = formatActiviteExperts(sessions, "aujourdhui", undefined, now);
  assert.match(out, /Djeneba/);
  assert.match(out, /Experts actifs \(1\)/);
});

test("formatAuditOutils: lists active and inactive connectors", () => {
  const out = formatAuditOutils([
    { toolkitSlug: "gmail", status: "ACTIVE", isDisabled: false, alias: "pro" },
    { toolkitSlug: "hubspot", status: "FAILED", isDisabled: false },
  ]);

  assert.match(out, /\*\*gmail\*\* \(pro\) : ✅ Actif/);
  assert.match(out, /\*\*hubspot\*\* : ⚠️ À reconnecter \/ Inactif/);
});

test("formatLivrablesRecents: formats list of files ignoring hidden ones", () => {
  const out = formatLivrablesRecents([
    { name: "rapport.xlsx", size: 10240, modified: Date.now() },
    { name: ".hidden", size: 50 },
    { name: "_memoire.md", size: 100 },
  ]);

  assert.match(out, /\*\*rapport\.xlsx\*\* \(10 Ko\)/);
  assert.doesNotMatch(out, /\.hidden/);
  assert.doesNotMatch(out, /_memoire\.md/);
});

test("formatStatistiquesAnalytique: shows total sessions and top experts with dynamic roles", () => {
  const experts: DiscoveredExpert[] = [
    { id: "fatima", name: "Fatima", description: "Marketing : campagnes..." },
    { id: "kouassi", name: "Kouassi", description: "Commercial : ventes..." },
  ];
  const sessions: RawSessionInfo[] = [
    { id: "1", profile: "fatima" },
    { id: "2", profile: "fatima" },
    { id: "3", profile: "kouassi" },
  ];
  const out = formatStatistiquesAnalytique(sessions, "synthese", experts);
  assert.match(out, /3 session\(s\)/);
  assert.match(out, /\*\*Fatima \(Marketing\)\*\* : 2 tâches \(67%\)/);
  assert.match(out, /\*\*Kouassi \(Commercial\)\*\* : 1 tâches \(33%\)/);
});

test("createYeleSupervisionBackend: connects supervision deps to YeleBackend interface", async () => {
  const b = createYeleSupervisionBackend({
    listInstalledExperts: async () => [
      { id: "fatima", name: "Fatima", description: "Marketing : création..." },
    ],
    listSessions: async () => [{ id: "1", profile: "fatima", last_active: Date.now() }],
    fetchFileContent: async (path) => (path.includes("daily") ? "Rapport du jour" : "model: claude-3-5"),
    listConnections: async () => [{ toolkitSlug: "gmail", status: "ACTIVE", isDisabled: false }],
    listDeliverableFiles: async () => [{ name: "doc.docx", size: 2048, modified: Date.now() }],
  });

  const act = await b.analyserActivite();
  assert.match(act, /Fatima/);

  const rep = await b.lireRapportJournalier("2026-10-28");
  assert.match(rep, /Rapport du jour/);

  const conns = await b.auditerOutils();
  assert.match(conns, /gmail/);

  const liv = await b.consulterLivrables();
  assert.match(liv, /doc\.docx/);

  const diag = await b.diagnostiquerConfiguration();
  assert.match(diag, /Hermes/);
});

test("lireRapportJournalier: rejects path traversal attempts", async () => {
  const b = createYeleSupervisionBackend({
    listSessions: async () => [],
    fetchFileContent: async () => "FICHIER_SECRET",
    listConnections: async () => [],
    listDeliverableFiles: async () => [],
  });

  const res1 = await b.lireRapportJournalier("../../../etc/passwd");
  assert.match(res1, /Format de date invalide/);

  const res2 = await b.lireRapportJournalier("2026-10-28/../../etc");
  assert.match(res2, /Format de date invalide/);

  const res3 = await b.lireRapportJournalier("2026-10-28; rm -rf");
  assert.match(res3, /Format de date invalide/);
});

test("formatCanauxEtTelegram: affiche forum Telegram, bot et fils par expert", () => {
  const tg = {
    bot: "yelema_bot",
    botId: 8800120542,
    chatTitle: "Yelema - Icone",
    chatId: -1004374515273,
    phase: "ready",
    inviteLink: "https://t.me/+invite",
    topics: { "12": "djeneba", "6": "adjoua" },
  };
  const mail = {
    addresses: { djeneba: "djeneba.mstudio@agentmail.to" },
  };
  const experts = [
    { id: "djeneba", name: "Djénéba", description: "Données : veille..." },
    { id: "adjoua", name: "Adjoua", description: "Recrutement : sourcing..." },
  ];

  // Test vue globale
  const globalOut = formatCanauxEtTelegram(tg, mail, experts);
  assert.match(globalOut, /Yelema - Icone/);
  assert.match(globalOut, /Fil #12/);
  assert.match(globalOut, /djeneba.mstudio@agentmail.to/);

  // Test filtré djénéba
  const singleOut = formatCanauxEtTelegram(tg, mail, experts, "djeneba");
  assert.match(singleOut, /Djénéba/);
  assert.match(singleOut, /Fil #12/);
  assert.match(singleOut, /yelema_bot/);
});

test("formatConsommationTokens: consolide le volume total, classement et zoom expert", () => {
  const stats = {
    djeneba: {
      count: 15,
      totalTokens: 3000000,
      promptTokens: 2980000,
      completionTokens: 20000,
      errors: 0,
      models: { "claude-opus-5-5": 8, default: 7 },
    },
    koffi: {
      count: 10,
      totalTokens: 1000000,
      promptTokens: 990000,
      completionTokens: 10000,
      errors: 0,
      models: { default: 10 },
    },
  };
  const experts = [
    { id: "djeneba", name: "Djénéba", description: "Données : analyse..." },
    { id: "koffi", name: "Koffi", description: "Design : création..." },
  ];

  // Test global
  const globalOut = formatConsommationTokens(stats, experts);
  assert.match(globalOut, /4 000 000/);
  assert.match(globalOut, /Djénéba/);
  assert.match(globalOut, /Koffi/);

  // Test ciblé
  const djenebaOut = formatConsommationTokens(stats, experts, "djeneba");
  assert.match(djenebaOut, /3 000 000/);
  assert.match(djenebaOut, /claude-opus-5-5/);
});

test("formatAlertesEtIncidents: rapporte 0 incident en état sain et liste les alertes", () => {
  const data = {
    incidents: [],
    avertissements: [
      { type: "CONNECTOR_WARNING", expert: "Djénéba", outil: "Transcription vocale", etat: "non-verifie" },
    ],
    totalCronsScanned: 195,
    telegramPhase: "ready",
  };

  const out = formatAlertesEtIncidents(data);
  assert.match(out, /AUCUN INCIDENT DÉTECTÉ/);
  assert.match(out, /0 incident détecté/);
  assert.match(out, /Transcription vocale/);
  assert.match(out, /Passerelle Telegram\*\* : 🟢 Opérationnelle/);
  assert.match(formatAlertesEtIncidents({ ...data, telegramPhase: null }), /Passerelle Telegram\*\* : non configurée/);
  assert.match(formatAlertesEtIncidents({ ...data, telegramPhase: "needs_topics" }), /En cours de configuration/);
});

test("formatAppelsEtVoix: affiche les briefs d'avant-appel et statut vocal", () => {
  const briefs = [
    { expId: "djeneba", at: "2026-10-29T08:54:00Z", text: "Relevé des 5 dernières sessions de Djénéba." },
    { expId: "adjoua", at: "2026-10-29T08:54:00Z", text: "Relevé des sessions d'Adjoua." },
  ];
  const experts = [
    { id: "djeneba", name: "Djénéba", description: "Chief of staff" },
    { id: "adjoua", name: "Adjoua", description: "Recrutement" },
  ];

  // Test global
  const globalOut = formatAppelsEtVoix(briefs, experts);
  assert.match(globalOut, /Supervision des Appels Vocaux/);
  assert.match(globalOut, /Djénéba/);
  assert.match(globalOut, /Adjoua/);

  // Test ciblé expert
  const singleOut = formatAppelsEtVoix(briefs, experts, "djeneba");
  assert.match(singleOut, /Brief d'Appel : Djénéba/);
  assert.match(singleOut, /Relevé des 5 dernières sessions/);
});

test("formatRechercheMemoire: extrait les passages pertinents avec auteur", () => {
  const results = [
    { expId: "djeneba", matches: ["Préparer les réunions et ordres du jour.", "Suivi des comptes rendus."] },
  ];
  const experts = [
    { id: "djeneba", name: "Djénéba", description: "Chief of staff" },
  ];

  const out = formatRechercheMemoire("réunion", results, experts);
  assert.match(out, /Résultats de Recherche dans la Mémoire : "réunion"/);
  assert.match(out, /Djénéba/);
  assert.match(out, /Préparer les réunions/);

  // Test sans résultat
  const emptyOut = formatRechercheMemoire("inconnu", [], experts);
  assert.match(emptyOut, /Aucune mention trouvée/);
});

test("formatSkillsExperts: affiche les modes opératoires spécifiques et transverses", () => {
  const skills = [
    {
      expId: "djeneba",
      specific: ["1-a-chaque-demande", "2-mon-metier", "4-livrables"],
      shared: ["research", "productivity", "email"],
    },
  ];
  const experts = [
    { id: "djeneba", name: "Djénéba", description: "Chief of staff" },
  ];

  // Test global
  const globalOut = formatSkillsExperts(skills, experts);
  assert.match(globalOut, /Cartographie des Compétences Métiers/);
  assert.match(globalOut, /\*\*3\*\* fiches/);

  // Test ciblé expert
  const singleOut = formatSkillsExperts(skills, experts, "djeneba");
  assert.match(singleOut, /Compétences & Méthodologies Métiers : Djénéba/);
  assert.match(singleOut, /1-a-chaque-demande/);
  assert.match(singleOut, /research/);
});

test("periodDays et usageForPeriod : jours UTC entiers, aujourd'hui compris", () => {
  const now = Date.parse("2026-11-09T10:00:00Z");
  assert.deepEqual([periodDays("aujourdhui", now).from, periodDays("aujourdhui", now).to], ["2026-11-09", "2026-11-09"]);
  assert.equal(periodDays("7_jours", now).from, "2026-11-03");
  assert.equal(periodDays("30_jours", now).from, "2026-10-11");

  const u = (count: number, totalTokens: number, errors = 0) => ({ count, totalTokens, promptTokens: totalTokens, completionTokens: 0, totalDurationMs: 1000 * count, errors, models: { m: count } });
  const byDay = {
    "2026-11-09": { a__koffi: u(1, 100) },
    "2026-11-05": { a__koffi: u(2, 50, 1), a__awa: u(1, 10) },
    "2026-10-01": { a__koffi: u(9, 9999) },
  };
  assert.deepEqual(Object.keys(usageForPeriod(byDay, "aujourdhui", now)), ["a__koffi"]);
  const week = usageForPeriod(byDay, "7_jours", now);
  assert.equal(week.a__koffi.count, 3);
  assert.equal(week.a__koffi.totalTokens, 150);
  assert.equal(week.a__koffi.errors, 1);
  assert.equal(week.a__koffi.models?.m, 3);
  assert.equal(week.a__awa.totalTokens, 10);
});

test("formatConsommationTokens : la période demandée figure dans le titre", () => {
  const stats = { a__koffi: { count: 2, totalTokens: 100, promptTokens: 60, completionTokens: 40, errors: 0 } };
  assert.match(formatConsommationTokens(stats, undefined, undefined, "les 7 derniers jours (UTC)"), /Tokens \(les 7 derniers jours \(UTC\)\)/);
  assert.doesNotMatch(formatConsommationTokens(stats), /Coût/);
  assert.doesNotMatch(formatConsommationTokens(stats), /UTC/);
});

test("formatCanauxEtTelegram : ajoute l'état des canaux lu sur l'instance", () => {
  const experts = [{ id: "a__koffi", name: "Koffi", description: "" }];
  const live = [{ id: "telegram", name: "Telegram", enabled: true, configured: true, state: "connected" }];
  assert.match(formatCanauxEtTelegram(null, null, experts, undefined, live), /Telegram : 🟢 connecté/);
  assert.match(formatCanauxEtTelegram(null, null, experts, undefined, null), /État illisible/);
  assert.doesNotMatch(formatCanauxEtTelegram(null, null, experts), /état lu sur l'instance/);
});

test("formatRoutinesPlanning : état, horaire et routines illisibles", () => {
  const r = (over: Record<string, unknown>) => ({ id: "1", name: "Point hebdo", task: "", summary: "", skills: [], attachment: null, schedule: "0 8 * * 1", enabled: true, suggested: false, lastRunAt: "2026-11-03T08:00:00Z", nextRunAt: "2026-11-10T08:00:00Z", ...over });
  const out = formatRoutinesPlanning([
    { expId: "a__koffi", expertName: "Koffi", routines: [r({}), r({ id: "2", name: "Veille", enabled: false, suggested: true, nextRunAt: null, lastRunAt: null })] },
    { expId: "a__awa", expertName: "Awa", routines: null },
  ]);
  assert.match(out, /Koffi\*\* : 2 routine\(s\), 1 active/);
  assert.match(out, /Point hebdo\*\* \(✅ active\)/);
  assert.match(out, /Veille\*\* \(💡 proposée/);
  assert.match(out, /Awa\*\* : ses routines sont illisibles/);
  assert.match(formatRoutinesPlanning([{ expId: "a__awa", expertName: "Awa", routines: [] }], "koffi"), /Aucun expert ne correspond/);
});

test("formatHistoriqueRoutines : vue d'équipe et résultat par exécution", () => {
  const now = Date.parse("2026-11-09T10:00:00Z");
  const runs = [
    { at: Date.parse("2026-11-08T08:00:00Z"), outcome: "sent" as const },
    { at: Date.parse("2026-11-07T08:00:00Z"), outcome: "failed" as const },
    { at: Date.parse("2026-10-01T08:00:00Z"), outcome: null },
  ];
  const list = [{ expId: "a__koffi", expertName: "Koffi", routines: [{ id: "1", name: "Point", enabled: true, runs }, { id: "2", name: "Veille", enabled: false, runs: [] }] }];
  const team = formatHistoriqueRoutines(list, undefined, now);
  assert.match(team, /2 exécution\(s\) sur 7 jours/);
  assert.match(team, /Veille\*\* : n'a encore jamais tourné \(en pause\)/);
  const one = formatHistoriqueRoutines(list, "koffi", now);
  assert.match(one, /✅ envoyée/);
  assert.match(one, /❌ échec/);
  assert.match(one, /résultat illisible/);
});

test("backend : routines et consommation par période, panne de lecture dite", async () => {
  const base = { listSessions: async () => [], fetchFileContent: async () => null, listConnections: async () => [], listDeliverableFiles: async () => [] };
  const b = createYeleSupervisionBackend({
    ...base,
    fetchUsageByDay: async () => ({ [new Date().toISOString().slice(0, 10)]: { a__koffi: { count: 1, totalTokens: 42, promptTokens: 40, completionTokens: 2, errors: 0 } } }),
    listRoutines: async () => { throw new Error("hors ligne"); },
  });
  assert.match(await b.analyserConsommationTokens(undefined, "aujourdhui"), /42/);
  assert.match(await b.consulterRoutines(), /Impossible de consulter les routines : hors ligne/);
  const none = createYeleSupervisionBackend(base);
  assert.match(await none.consulterHistoriqueRoutine(), /pas lisible/);
});
