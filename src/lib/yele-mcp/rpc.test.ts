import assert from "node:assert/strict";
import { test } from "node:test";
import { answerRpc, type YeleBackend } from "./rpc.ts";

const mockBackend = (over: Partial<YeleBackend> = {}): YeleBackend => ({
  analyserActivite: async (p) => `Activité (${p ?? "aujourdhui"}): Fatima et Kouassi actifs, Salif inactif.`,
  lireRapportJournalier: async (d) => `Rapport du ${d ?? "aujourdhui"}: 14 tâches accomplies.`,
  auditerOutils: async (e) => `Outils (${e ?? "tous"}): Gmail (Actif), LinkedIn (Actif).`,
  consulterLivrables: async (l) => `Derniers livrables (${l ?? 10}): rapport_q3.xlsx, pitch.pptx.`,
  statistiquesAnalytique: async (v) => `Stats (${v ?? "synthese"}): 95% succès routines, 18 documents.`,
  consulterCanauxTelegram: async (e) => `Telegram (${e ?? "tous"}): Bot @yelema_bot, Forum Yelema - Icone.`,
  analyserConsommationTokens: async (e) => `Tokens (${e ?? "tous"}): 34M tokens, Djénéba top consommateur.`,
  consulterRoutines: async (e) => `Routines (${e ?? "tous"}).`,
  consulterHistoriqueRoutine: async (e) => `Historique (${e ?? "tous"}).`,
  consulterAlertesIncidents: async (e) => `Alertes (${e ?? "tous"}): 0 incident critique, crons 100% sains.`,
  consulterAppelsEtVoix: async (e) => `Voix (${e ?? "tous"}): 12 briefs d'appel prêts.`,
  rechercherDansLaMemoire: async (q, e) => `Recherche '${q}' (${e ?? "tous"}): 3 correspondances.`,
  consulterSkillsExperts: async (e) => `Skills (${e ?? "tous"}): 8 modules métiers.`,
  trouverCommande: async (b) => `Commande pour ${b ?? "tout"}.`,
  diagnostiquerConfiguration: async () => "Configuration saine: Telegram OK, mémoire OK, secrets masqués.",
  ...over,
});

const rpc = (method: string, params?: unknown) => ({ jsonrpc: "2.0", id: 1, method, params });
const textOf = (answer: unknown) => (answer as { result: { content: { text: string }[]; isError?: boolean } }).result;

test("yele-mcp: handshake initialize and ping", async () => {
  const init = await answerRpc(rpc("initialize", { protocolVersion: "2025-06-18" }), mockBackend());
  assert.equal((init?.result as { serverInfo: { name: string } }).serverInfo.name, "yele-supervision");
  assert.equal(await answerRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, mockBackend()), null);
  const ping = await answerRpc(rpc("ping"), mockBackend());
  assert.deepEqual(ping?.result, {});
});

test("yele-mcp: lists the 12 super-power tools", async () => {
  const list = await answerRpc(rpc("tools/list"), mockBackend());
  const names = (list?.result as { tools: { name: string }[] }).tools.map((t) => t.name);
  assert.deepEqual(names, [
    "analyser_activite_experts",
    "lire_rapport_journalier",
    "auditer_outils_connecteurs",
    "consulter_livrables_recents",
    "statistiques_et_analytique",
    "consulter_canaux_et_telegram",
    "analyser_consommation_tokens_et_couts",
    "consulter_routines_et_planning",
    "consulter_historique_routine",
    "consulter_alertes_et_incidents",
    "consulter_appels_et_voix",
    "rechercher_dans_la_memoire",
    "consulter_skills_experts",
    "trouver_une_commande",
    "diagnostiquer_configuration",
  ]);
});

test("yele-mcp: tool calls execute backend methods correctly", async () => {
  const b = mockBackend();

  const act = textOf(await answerRpc(rpc("tools/call", { name: "analyser_activite_experts", arguments: { periode: "7_jours" } }), b));
  assert.match(act.content[0].text, /Activité \(7_jours\)/);

  const rep = textOf(await answerRpc(rpc("tools/call", { name: "lire_rapport_journalier", arguments: { date: "2026-10-27" } }), b));
  assert.match(rep.content[0].text, /Rapport du 2026-10-27/);

  const out = textOf(await answerRpc(rpc("tools/call", { name: "auditer_outils_connecteurs", arguments: { expert: "fatima" } }), b));
  assert.match(out.content[0].text, /Outils \(fatima\)/);

  const liv = textOf(await answerRpc(rpc("tools/call", { name: "consulter_livrables_recents", arguments: { limite: 5 } }), b));
  assert.match(liv.content[0].text, /Derniers livrables \(5\)/);

  const stats = textOf(await answerRpc(rpc("tools/call", { name: "statistiques_et_analytique", arguments: { vue: "routines" } }), b));
  assert.match(stats.content[0].text, /Stats \(routines\)/);


  const tg = textOf(await answerRpc(rpc("tools/call", { name: "consulter_canaux_et_telegram", arguments: { expert: "djeneba" } }), b));
  assert.match(tg.content[0].text, /Telegram \(djeneba\)/);

  const tok = textOf(await answerRpc(rpc("tools/call", { name: "analyser_consommation_tokens_et_couts", arguments: {} }), b));
  assert.match(tok.content[0].text, /Tokens \(tous\)/);

  const al = textOf(await answerRpc(rpc("tools/call", { name: "consulter_alertes_et_incidents", arguments: {} }), b));
  assert.match(al.content[0].text, /Alertes \(tous\)/);


  const vx = textOf(await answerRpc(rpc("tools/call", { name: "consulter_appels_et_voix", arguments: { expert: "djeneba" } }), b));
  assert.match(vx.content[0].text, /Voix \(djeneba\)/);

  const mem = textOf(await answerRpc(rpc("tools/call", { name: "rechercher_dans_la_memoire", arguments: { requete: "réunion" } }), b));
  assert.match(mem.content[0].text, /Recherche 'réunion'/);

  const sk = textOf(await answerRpc(rpc("tools/call", { name: "consulter_skills_experts", arguments: { expert: "djeneba" } }), b));
  assert.match(sk.content[0].text, /Skills \(djeneba\)/);

  const diag = textOf(await answerRpc(rpc("tools/call", { name: "diagnostiquer_configuration", arguments: {} }), b));
  assert.match(diag.content[0].text, /Configuration saine/);
});

test("yele-mcp: unknown tool and error propagation", async () => {
  const b = mockBackend();
  const unk = textOf(await answerRpc(rpc("tools/call", { name: "faire_magie", arguments: {} }), b));
  assert.equal(unk.isError, true);
  assert.match(unk.content[0].text, /Outil inconnu/);

  const fail = mockBackend({
    analyserActivite: async () => {
      throw new Error("Instance inaccessible");
    },
  });
  const err = textOf(await answerRpc(rpc("tools/call", { name: "analyser_activite_experts", arguments: {} }), fail));
  assert.equal(err.isError, true);
  assert.match(err.content[0].text, /Instance inaccessible/);
});
