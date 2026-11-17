// Protocole MCP JSON-RPC 2.0 du serveur de Yélé : reçoit un message, appelle l'outil demandé sur le backend.

import { YELE_TOOLS } from "./tools.ts";

export interface YeleBackend {
  analyserActivite(periode?: string): Promise<string>;
  lireRapportJournalier(date?: string): Promise<string>;
  auditerOutils(expert?: string): Promise<string>;
  consulterLivrables(limite?: number): Promise<string>;
  statistiquesAnalytique(vue?: string): Promise<string>;
  diagnostiquerConfiguration(): Promise<string>;
  consulterCanauxTelegram(expert?: string): Promise<string>;
  analyserConsommationTokens(expert?: string, periode?: string): Promise<string>;
  consulterRoutines(expert?: string): Promise<string>;
  consulterHistoriqueRoutine(expert?: string): Promise<string>;
  consulterAlertesIncidents(expert?: string): Promise<string>;
  consulterAppelsEtVoix(expert?: string): Promise<string>;
  rechercherDansLaMemoire(requete: string, expert?: string): Promise<string>;
  consulterSkillsExperts(expert?: string): Promise<string>;
  trouverCommande(besoin?: string, expert?: string): Promise<string>;
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type RpcAnswer = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const text = (value: string, isError = false) => ({
  content: [{ type: "text", text: value }],
  ...(isError ? { isError: true } : {}),
});

async function callTool(backend: YeleBackend, name: unknown, args: Record<string, unknown>) {
  switch (name) {
    case "analyser_activite_experts": {
      const p = typeof args.periode === "string" ? args.periode : undefined;
      return text(await backend.analyserActivite(p));
    }
    case "lire_rapport_journalier": {
      const d = typeof args.date === "string" ? args.date : undefined;
      return text(await backend.lireRapportJournalier(d));
    }
    case "auditer_outils_connecteurs": {
      const e = typeof args.expert === "string" ? args.expert : undefined;
      return text(await backend.auditerOutils(e));
    }
    case "consulter_livrables_recents": {
      const l = typeof args.limite === "number" ? args.limite : undefined;
      return text(await backend.consulterLivrables(l));
    }
    case "statistiques_et_analytique": {
      const v = typeof args.vue === "string" ? args.vue : undefined;
      return text(await backend.statistiquesAnalytique(v));
    }
    case "consulter_canaux_et_telegram": {
      const e = typeof args.expert === "string" ? args.expert : undefined;
      return text(await backend.consulterCanauxTelegram(e));
    }
    case "analyser_consommation_tokens_et_couts": {
      const e = typeof args.expert === "string" ? args.expert : undefined;
      const p = typeof args.periode === "string" ? args.periode : undefined;
      return text(await backend.analyserConsommationTokens(e, p));
    }
    case "consulter_routines_et_planning": {
      const e = typeof args.expert === "string" ? args.expert : undefined;
      return text(await backend.consulterRoutines(e));
    }
    case "consulter_historique_routine": {
      const e = typeof args.expert === "string" ? args.expert : undefined;
      return text(await backend.consulterHistoriqueRoutine(e));
    }
    case "consulter_alertes_et_incidents": {
      const e = typeof args.expert === "string" ? args.expert : undefined;
      return text(await backend.consulterAlertesIncidents(e));
    }
    case "consulter_appels_et_voix": {
      const e = typeof args.expert === "string" ? args.expert : undefined;
      return text(await backend.consulterAppelsEtVoix(e));
    }
    case "rechercher_dans_la_memoire": {
      const q = typeof args.requete === "string" ? args.requete : "";
      const e = typeof args.expert === "string" ? args.expert : undefined;
      return text(await backend.rechercherDansLaMemoire(q, e));
    }
    case "consulter_skills_experts": {
      const e = typeof args.expert === "string" ? args.expert : undefined;
      return text(await backend.consulterSkillsExperts(e));
    }
    case "trouver_une_commande": {
      const b = typeof args.besoin === "string" ? args.besoin : undefined;
      const e = typeof args.expert === "string" ? args.expert : undefined;
      return text(await backend.trouverCommande(b, e));
    }
    case "diagnostiquer_configuration": {
      return text(await backend.diagnostiquerConfiguration());
    }
    default:
      return text("Outil inconnu.", true);
  }
}

/**
 * Traite un message JSON-RPC 2.0 pour le serveur MCP Yélé.
 */
export async function answerRpc(message: unknown, backend: YeleBackend): Promise<RpcAnswer | null> {
  const rpc = (message && typeof message === "object" ? message : {}) as Rpc;
  const id = rpc.id ?? null;
  if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
    return { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } };
  }
  if (rpc.id === undefined) return null;
  const ok = (result: unknown): RpcAnswer => ({ jsonrpc: "2.0", id, result });

  switch (rpc.method) {
    case "initialize":
      return ok({
        protocolVersion: typeof rpc.params?.protocolVersion === "string" ? rpc.params.protocolVersion : "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "yele-supervision", version: "1.0.0" },
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: YELE_TOOLS });
    case "tools/call": {
      const args = rpc.params?.arguments;
      try {
        return ok(await callTool(backend, rpc.params?.name, args && typeof args === "object" ? (args as Record<string, unknown>) : {}));
      } catch (e) {
        if ((e as { status?: number }).status === 401) throw e;
        return ok(text(e instanceof Error && e.message ? e.message : "Erreur lors de l'exécution de l'outil.", true));
      }
    }
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
  }
}
