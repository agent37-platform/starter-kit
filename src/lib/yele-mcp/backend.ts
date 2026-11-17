// Le backend du serveur de Yélé : pour chaque outil, lire les données puis les mettre en texte.
// Ni lecture ni mise en forme ici : la lecture est dans les dépendances, la mise en forme dans ./formatters.
import { commandGuide } from "../command-guide.ts";
import { readDailyReport } from "./daily-report.ts";
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
import { HERMES_FILES, homeFile, INSTANCE_DIRS } from "./hermes-layout.ts";
import { periodDays, usageForPeriod } from "./periods.ts";
import type { YeleBackend } from "./rpc.ts";
import type { DiscoveredExpert, SupervisionDeps } from "./types.ts";

/** La réponse de l'outil, ou la phrase qui dit pourquoi elle manque : une panne ne casse pas le serveur. */
async function attempt(failure: string, run: () => Promise<string>): Promise<string> {
  try {
    return await run();
  } catch (e) {
    return `${failure} : ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * Les experts installés, ou undefined si l'instance n'en dit rien ou n'a pas pu être lue : leurs noms
 * complètent une réponse sans la bloquer, chaque expert gardant alors son identifiant.
 */
async function installedExperts(deps: SupervisionDeps): Promise<DiscoveredExpert[] | undefined> {
  const experts = deps.listInstalledExperts ? await deps.listInstalledExperts().catch(() => []) : [];
  return experts.length > 0 ? experts : undefined;
}

export function createYeleSupervisionBackend(deps: SupervisionDeps): YeleBackend {
  return {
    async consulterRoutines(targetExpert?: string): Promise<string> {
      if (!deps.listRoutines) return "Les routines ne sont pas lisibles sur cette instance.";
      const listRoutines = deps.listRoutines;
      return attempt("Impossible de consulter les routines", async () =>
        formatRoutinesPlanning(await listRoutines(), targetExpert)
      );
    },

    async consulterHistoriqueRoutine(targetExpert?: string): Promise<string> {
      if (!deps.listRoutineRuns) return "L'historique des routines n'est pas lisible sur cette instance.";
      const listRoutineRuns = deps.listRoutineRuns;
      return attempt("Impossible de consulter l'historique des routines", async () =>
        formatHistoriqueRoutines(await listRoutineRuns(targetExpert), targetExpert)
      );
    },

    analyserActivite(periode?: string): Promise<string> {
      return attempt("Impossible de récupérer les sessions d'activité", async () => {
        const [sessions, experts] = await Promise.all([deps.listSessions(), installedExperts(deps)]);
        return formatActiviteExperts(sessions, periode, experts);
      });
    },

    lireRapportJournalier(dateStr?: string): Promise<string> {
      return readDailyReport(deps.fetchFileContent, dateStr);
    },

    auditerOutils(targetExpert?: string): Promise<string> {
      return attempt("Impossible d'auditer les outils", async () =>
        formatAuditOutils(await deps.listConnections(), targetExpert)
      );
    },

    consulterLivrables(limite = 10): Promise<string> {
      return attempt("Erreur lors de la lecture des livrables", async () =>
        formatLivrablesRecents(await deps.listDeliverableFiles(), limite)
      );
    },

    statistiquesAnalytique(vue?: string): Promise<string> {
      return attempt("Impossible de calculer les statistiques analytiques", async () => {
        const [sessions, experts] = await Promise.all([deps.listSessions(), installedExperts(deps)]);
        return formatStatistiquesAnalytique(sessions, vue, experts);
      });
    },

    consulterCanauxTelegram(targetExpert?: string): Promise<string> {
      return attempt("Impossible de consulter les canaux Telegram", async () => {
        const [tg, mail, experts, channels] = await Promise.all([
          deps.fetchTelegramConfig ? deps.fetchTelegramConfig() : Promise.resolve(null),
          deps.fetchMailConfig ? deps.fetchMailConfig() : Promise.resolve(null),
          installedExperts(deps),
          deps.listChannels ? deps.listChannels().catch(() => null) : Promise.resolve(undefined),
        ]);
        return formatCanauxEtTelegram(tg, mail, experts, targetExpert, channels);
      });
    },

    analyserConsommationTokens(targetExpert?: string, periode?: string): Promise<string> {
      return attempt("Impossible d'analyser la consommation de tokens", async () => {
        const byPeriod = Boolean(periode && periode !== "tout" && deps.fetchUsageByDay);
        const [stats, experts] = await Promise.all([
          byPeriod
            ? deps.fetchUsageByDay!().then((d) => usageForPeriod(d, periode))
            : deps.fetchUsageStats
              ? deps.fetchUsageStats()
              : Promise.resolve(null),
          installedExperts(deps),
        ]);
        const label = byPeriod ? periodDays(periode).label : undefined;
        return formatConsommationTokens(stats, experts, targetExpert, label);
      });
    },

    consulterAlertesIncidents(targetExpert?: string): Promise<string> {
      return attempt("Impossible de consulter les alertes et incidents", async () => {
        const [alerts, experts] = await Promise.all([
          deps.fetchIncidentAlerts ? deps.fetchIncidentAlerts() : Promise.resolve(null),
          installedExperts(deps),
        ]);
        return formatAlertesEtIncidents(alerts, experts, targetExpert);
      });
    },

    consulterAppelsEtVoix(targetExpert?: string): Promise<string> {
      return attempt("Impossible de consulter les briefs vocaux", async () => {
        const [briefs, experts] = await Promise.all([
          deps.fetchVoiceBriefs ? deps.fetchVoiceBriefs() : Promise.resolve(null),
          installedExperts(deps),
        ]);
        return formatAppelsEtVoix(briefs, experts, targetExpert);
      });
    },

    rechercherDansLaMemoire(requete: string, targetExpert?: string): Promise<string> {
      return attempt("Impossible d'effectuer la recherche en mémoire", async () => {
        const [results, experts] = await Promise.all([
          deps.searchMemories ? deps.searchMemories(requete, targetExpert) : Promise.resolve(null),
          installedExperts(deps),
        ]);
        return formatRechercheMemoire(requete, results, experts, targetExpert);
      });
    },

    consulterSkillsExperts(targetExpert?: string): Promise<string> {
      return attempt("Impossible de consulter les compétences métiers", async () => {
        const [skills, experts] = await Promise.all([
          deps.fetchSkillsCatalog ? deps.fetchSkillsCatalog(targetExpert) : Promise.resolve(null),
          installedExperts(deps),
        ]);
        return formatSkillsExperts(skills, experts, targetExpert);
      });
    },

    async trouverCommande(besoin?: string, expert?: string): Promise<string> {
      const experts = deps.listInstalledExperts ? await deps.listInstalledExperts().catch(() => []) : [];
      return commandGuide(experts, besoin, expert);
    },

    diagnostiquerConfiguration(): Promise<string> {
      return attempt("Diagnostic impossible", async () =>
        formatDiagnosticConfiguration(await deps.fetchFileContent(homeFile(INSTANCE_DIRS.hermes, HERMES_FILES.config)))
      );
    },
  };
}
