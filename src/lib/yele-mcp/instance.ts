import "server-only";
import { toMs } from "@/lib/activity";
import { agent37, instanceFetch } from "@/lib/agent37";
import { loadCatalogue, matchCatalogue } from "@/lib/catalogue";
import { listConnections } from "@/lib/composio";
import { expertDisplayName } from "@/lib/experts";
import { withTimeout } from "@/lib/fetch-timeout";
import { listPlatforms } from "@/lib/hermes-messaging";
import { isProfileId, profileQuery } from "@/lib/profile-id";
import { routinesOf } from "@/lib/routine-store";
import { isRunOf, runOutcome } from "@/lib/routines";
import { deliverablesReader, parseDeliverables } from "./deliverables.ts";
import { discoverExpertsReader, parseDiscoveredExperts } from "./discover-experts.ts";
import type { InstanceReader } from "./hermes-layout.ts";
import { instanceDiagReader, parseInstanceDiag } from "./instance-diag.ts";
import { instanceSetupReader, parseInstanceSetup } from "./instance-setup.ts";
import { memorySearchReader, parseMemorySearch } from "./memory-search.ts";
import { ReaderError, runPythonReader } from "./python-reader.ts";
import { sessionUsageReader } from "./session-usage/command.ts";
import { parseSessionUsage, usageByDayOf, usageByProfile, withRoutineErrors } from "./session-usage/usage.ts";
import type {
  ChannelState,
  DiscoveredExpert,
  ExpertRoutineRuns,
  ExpertRoutines,
  InstanceDiag,
  InstanceSetup,
  MemorySearchResult,
  RawFileInfo,
  RawSessionInfo,
  SessionUsage,
  SupervisionDeps,
} from "./types.ts";

// Lecture d'une instance pour le serveur MCP de Yélé et pour l'analytique : experts, sessions,
// routines, consommation, connecteurs, canaux, livrables et mémoire.

const TIMEOUT_MS = 15_000;
// Historique détaillé des routines d'un expert : nombre d'exécutions par routine et de résultats lus.
const RUNS_PER_ROUTINE = 5;
const MAX_OUTCOME_READS = 25;

const UNREADABLE = "les fichiers de l'instance sont illisibles pour le moment";

/** Journalise l'échec d'une lecture ; son texte ne quitte pas le serveur. */
function logFailure(agentId: string, what: string, err: unknown): void {
  console.warn(`[yele-mcp] ${what} illisible sur ${agentId} : ${(err instanceof Error ? err.message : String(err)).slice(0, 400)}`);
}

/** Exécute un lecteur et valide son résultat ; journalise et lève `unreadable` en cas d'échec. */
async function readOnInstance<T>(agentId: string, what: string, reader: InstanceReader, parse: (json: string) => T, unreadable = UNREADABLE): Promise<T> {
  try {
    return await runPythonReader((command) => agent37.exec(agentId, command), reader.script, reader.params, parse);
  } catch (e) {
    const why = e instanceof ReaderError ? `${e.reason} ${e.detail}` : `sortie inattendue : ${e instanceof Error ? e.message : String(e)}`;
    console.warn(`[yele-mcp] ${what} illisible sur ${agentId} : ${why.slice(0, 400)}`);
    throw new Error(unreadable);
  }
}

export const readInstanceDiag = (agentId: string): Promise<InstanceDiag> => readOnInstance(agentId, "diagnostic", instanceDiagReader(), parseInstanceDiag);

export const readSessionUsage = (agentId: string): Promise<SessionUsage> => readOnInstance(agentId, "sessions", sessionUsageReader(), parseSessionUsage);

export const readInstanceSetup = (agentId: string): Promise<InstanceSetup> =>
  readOnInstance(agentId, "configuration des profils", instanceSetupReader(), parseInstanceSetup);

export const discoverInstalledExperts = (agentId: string): Promise<DiscoveredExpert[]> =>
  readOnInstance(agentId, "experts", discoverExpertsReader(), parseDiscoveredExperts, "les experts de l'instance sont illisibles pour le moment");

const readDeliverables = (agentId: string): Promise<RawFileInfo[]> =>
  readOnInstance(agentId, "livrables", deliverablesReader(), parseDeliverables, "le dossier Livrables est illisible pour le moment");

const searchMemoriesInSandbox = (agentId: string, query: string, expert?: string): Promise<MemorySearchResult[]> =>
  readOnInstance(agentId, "mémoire", memorySearchReader(query, expert), parseMemorySearch, "la mémoire des experts est illisible pour le moment");

async function expertNames(experts: DiscoveredExpert[]): Promise<Map<string, string>> {
  const catalogue = await loadCatalogue();
  return new Map(experts.map((e) => [e.id, matchCatalogue(catalogue.experts, e.id)?.name ?? expertDisplayName(e.id)]));
}

async function readRoutines(agentId: string, experts: DiscoveredExpert[]): Promise<ExpertRoutines[]> {
  const [store, names] = await Promise.all([routinesOf(agentId), expertNames(experts)]);
  return Promise.all(
    experts.map(async (e) => {
      const expertName = names.get(e.id) ?? e.name;
      try {
        return { expId: e.id, expertName, routines: await store.list(agentId, e.id, expertName) };
      } catch (err) {
        logFailure(agentId, `routines de ${e.id}`, err);
        return { expId: e.id, expertName, routines: null };
      }
    })
  );
}

// Exécutions de chaque routine : sessions associées par id, sinon par titre avec ou sans le nom de l'expert.
async function readRoutineRuns(agentId: string, routines: ExpertRoutines, detailed: boolean): Promise<ExpertRoutineRuns> {
  const { expId, expertName } = routines;
  if (!routines.routines) return { expId, expertName, routines: null };
  const query = profileQuery(expId);
  let sessions;
  try {
    sessions = (await agent37.listSessions(agentId, query)).data;
  } catch (err) {
    logFailure(agentId, `sessions des routines de ${expId}`, err);
    return { expId, expertName, routines: null };
  }
  let reads = 0;
  const out = await Promise.all(
    routines.routines.map(async (r) => {
      const runs = sessions
        .filter((s) => isRunOf(s, { id: r.id, hermesName: r.name }) || isRunOf(s, { id: r.id, hermesName: `${r.name} (${expertName})` }))
        .map((s) => ({ sessionId: s.id, at: toMs(s.last_active ?? s.started_at ?? 0) }))
        .sort((a, b) => b.at - a.at);
      const shown = detailed ? runs.slice(0, RUNS_PER_ROUTINE) : runs;
      return {
        id: r.id,
        name: r.name,
        enabled: r.enabled,
        runs: await Promise.all(
          shown.map(async (run) => {
            if (!detailed || reads >= MAX_OUTCOME_READS) return { at: run.at, outcome: null };
            reads++;
            try {
              const { history } = await agent37.getSession(agentId, run.sessionId, query);
              const last = history.findLast((m) => m.role === "assistant");
              return { at: run.at, outcome: runOutcome(typeof last?.content === "string" ? last.content : null) };
            } catch {
              return { at: run.at, outcome: null };
            }
          })
        ),
      };
    })
  );
  return { expId, expertName, routines: out };
}

async function readChannels(agentId: string): Promise<ChannelState[]> {
  const platforms = await listPlatforms(agentId);
  return platforms
    .filter((p) => p.enabled || p.configured)
    .map((p) => ({ id: p.id, name: p.name, enabled: p.enabled, configured: p.configured, state: p.state }));
}

/** Sources lues sur une instance, chacune lue une seule fois par requête. */
export function yeleSupervisionDeps(
  agentId: string,
  composioUser: string
): SupervisionDeps & {
  diag: () => Promise<InstanceDiag>;
  sessionUsage: () => Promise<SessionUsage>;
  instanceSetup: () => Promise<InstanceSetup>;
  listInstalledExperts: () => Promise<DiscoveredExpert[]>;
  listChannels: () => Promise<ChannelState[]>;
} {
  const once = <T>(load: () => Promise<T>) => {
    let p: Promise<T> | null = null;
    return () => (p ??= load());
  };
  const diag = once(() => readInstanceDiag(agentId));
  const sessionUsage = once(() => readSessionUsage(agentId));
  // Diagnostic utilisé pour le nombre de routines en échec.
  const routineAudit = async () => (await diag().catch(() => null)) ?? null;
  const experts = once(() => discoverInstalledExperts(agentId));
  const routines = once(async () => readRoutines(agentId, await experts()));

  const listSessions = async (): Promise<RawSessionInfo[]> => {
    const ids = (await experts()).map((e) => e.id);
    if (ids.length === 0) {
      const { data } = await agent37.listSessions(agentId);
      return data.map((s) => ({
        id: s.id,
        profile: (s as { profile?: string | null }).profile ?? null,
        last_active: s.last_active,
        started_at: s.started_at,
      }));
    }
    const perExpert = await Promise.all(
      ids.map(async (exp) => {
        try {
          const { data } = await agent37.listSessions(agentId, profileQuery(exp));
          return data.map((s) => ({ id: s.id, profile: exp, last_active: s.last_active, started_at: s.started_at }));
        } catch {
          return [];
        }
      })
    );
    return perExpert.flat();
  };

  return {
    diag,
    sessionUsage,
    instanceSetup: once(() => readInstanceSetup(agentId)),
    listInstalledExperts: experts,
    listSessions: once(listSessions),
    fetchTelegramConfig: async () => (await diag()).telegram,
    fetchMailConfig: async () => (await diag()).mail,
    fetchUsageStats: async () => {
      const [usage, audit] = await Promise.all([sessionUsage(), routineAudit()]);
      return withRoutineErrors(usageByProfile(usage.totals), audit?.routineErrors);
    },
    fetchUsageByDay: async () => {
      const [usage, audit] = await Promise.all([sessionUsage(), routineAudit()]);
      const byDay = usageByDayOf(usage.rows);
      for (const [day, perExpert] of Object.entries(byDay)) withRoutineErrors(perExpert, audit?.routineErrorsByDay[day]);
      return byDay;
    },
    fetchIncidentAlerts: async () => (await diag()).alerts,
    fetchVoiceBriefs: async () => (await diag()).voiceBriefs,
    fetchSkillsCatalog: async () => (await diag()).skills,
    fetchExpertConnectors: async () => (await diag()).connectors,
    // Un expert au format invalide ne donne aucun résultat.
    searchMemories: async (q: string, exp?: string) => (exp && !isProfileId(exp.trim()) ? [] : searchMemoriesInSandbox(agentId, q, exp)),
    listRoutines: routines,
    listRoutineRuns: async (expert?: string) => {
      const all = await routines();
      const wanted = expert?.trim().toLowerCase();
      const chosen = wanted
        ? all.filter((r) => r.expId.toLowerCase() === wanted || r.expertName.toLowerCase() === wanted || r.expId.toLowerCase().endsWith(`__${wanted}`))
        : all;
      return Promise.all(chosen.map((r) => readRoutineRuns(agentId, r, Boolean(wanted))));
    },
    listChannels: once(() => readChannels(agentId)),
    fetchFileContent: async (path: string): Promise<string | null> => {
      try {
        const res = await instanceFetch(agentId, `/v1/files/content?path=${encodeURIComponent(path)}`, withTimeout(undefined, TIMEOUT_MS));
        return res.ok ? await res.text() : null;
      } catch {
        return null;
      }
    },
    listConnections: async () => {
      const { connections } = await listConnections(composioUser);
      return connections.map((c) => ({ toolkitSlug: c.toolkitSlug, toolkitName: c.toolkitName, status: c.status, isDisabled: c.isDisabled, alias: c.alias }));
    },
    listDeliverableFiles: once(() => readDeliverables(agentId)),
  };
}
