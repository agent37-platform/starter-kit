// Les données que le serveur de Yélé lit sur une instance, et ce dont il a besoin pour les lire.

import type { Routine, RunOutcome } from "../routines.ts";

/** Expert découvert dynamiquement dans la sandbox (~/.hermes/profiles) */
export interface DiscoveredExpert {
  id: string;
  name: string;
  description: string;
}

export interface RawSessionInfo {
  id: string;
  profile?: string | null;
  last_active?: number | null;
  started_at?: number | null;
}

export interface RawConnectionInfo {
  toolkitSlug?: string | null;
  toolkitName?: string | null;
  status?: string | null;
  isDisabled?: boolean | null;
  alias?: string | null;
}

export interface RawFileInfo {
  name: string;
  /** Path under ~/Livrables. */
  path?: string;
  size?: number | null;
  modified?: number | null;
}

export interface TelegramConfig {
  bot?: string;
  botId?: number;
  chatTitle?: string;
  chatId?: number;
  phase?: string;
  inviteLink?: string;
  topics?: Record<string, string>;
}

export interface MailConfig {
  /** Id d'expert → adresse. */
  addresses?: Record<string, string>;
}

export interface ExpertUsageData {
  count: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalDurationMs?: number;
  avgDurationSec?: number;
  models?: Record<string, number>;
  /** Tokens per model (`default` when the run names none), where `models` counts runs. */
  modelTokens?: Record<string, number>;
  /** Per channel the sessions came from (`cron`, `telegram`, `agent37-gateway`…), as Hermes names it. */
  sources?: Record<string, ChannelUsage>;
  messages?: number;
  toolCalls?: number;
  errors: number;
  recentExecs?: Array<{
    ts: string;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    durationMs: number;
    model: string;
    error: string | null;
  }>;
}

export interface IncidentAlertData {
  incidents: Array<{
    type: string;
    expert: string;
    ts?: string;
    model?: string;
    error?: string;
    outil?: string;
    note?: string;
  }>;
  avertissements: Array<{
    type: string;
    expert: string;
    outil?: string;
    etat?: string;
    usage?: string;
    message?: string;
  }>;
  totalCronsScanned: number;
  /** Phase du groupe Telegram dans telegram.json ; null sans groupe. */
  telegramPhase: string | null;
}

/** Résultat du lecteur instance-diag. */
export interface InstanceDiag {
  telegram: TelegramConfig | null;
  mail: MailConfig | null;
  /** Exécutions de routine en échec par expert. */
  routineErrors: Record<string, number>;
  /** Exécutions en échec par jour UTC puis par expert. */
  routineErrorsByDay: Record<string, Record<string, number>>;
  connectors: Record<string, ExpertConnector[]>;
  skills: ExpertSkillInfo[];
  voiceBriefs: VoiceBriefInfo[];
  alerts: IncidentAlertData;
  /** Fichiers illisibles (`audit:<expert>`, `telegram`…). */
  unreadable: string[];
}

export interface VoiceBriefInfo {
  expId: string;
  at?: string;
  text?: string;
}

export interface MemorySearchResult {
  expId: string;
  matches: string[];
}

export interface ExpertSkillInfo {
  expId: string;
  specific: string[];
  shared: string[];
}

export interface SupervisionDeps {
  listSessions: () => Promise<RawSessionInfo[]>;
  fetchFileContent: (path: string) => Promise<string | null>;
  listConnections: () => Promise<RawConnectionInfo[]>;
  listDeliverableFiles: () => Promise<RawFileInfo[]>;
  listInstalledExperts?: () => Promise<DiscoveredExpert[]>;
  fetchTelegramConfig?: () => Promise<TelegramConfig | null>;
  fetchMailConfig?: () => Promise<MailConfig | null>;
  fetchUsageStats?: () => Promise<Record<string, ExpertUsageData> | null>;
  fetchIncidentAlerts?: () => Promise<IncidentAlertData | null>;
  fetchVoiceBriefs?: () => Promise<VoiceBriefInfo[] | null>;
  searchMemories?: (query: string, expert?: string) => Promise<MemorySearchResult[] | null>;
  fetchSkillsCatalog?: (expert?: string) => Promise<ExpertSkillInfo[] | null>;
  fetchUsageByDay?: () => Promise<UsageByDay>;
  fetchExpertConnectors?: () => Promise<Record<string, ExpertConnector[]>>;
  listRoutines?: () => Promise<ExpertRoutines[]>;
  listRoutineRuns?: (expert?: string) => Promise<ExpertRoutineRuns[]>;
  listChannels?: () => Promise<ChannelState[]>;
}

/** Usage per UTC day (AAAA-MM-JJ), then per expert. */
export type UsageByDay = Record<string, Record<string, ExpertUsageData>>;

export interface ChannelUsage {
  sessions: number;
  tokens: number;
}

/** Consommation d'un groupe de sessions. */
export interface SessionMetrics {
  sessions: number;
  messages: number;
  toolCalls: number;
  /** Appels à l'API du modèle. */
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  durationMs: number;
}

/** Dimensions d'une session : profil, canal (`source`), modèle et routine (vide hors routine). */
export interface SessionDims {
  profile: string;
  source: string;
  model: string;
  /** Id de la routine dans cron/jobs.json, vide si la session n'est pas une exécution de routine. */
  routine: string;
}

/** Consommation d'un créneau pour un jeu de dimensions ; sessions, messages et durée comptés sur le modèle de la session. */
export interface SessionUsageRow extends SessionMetrics, SessionDims {
  /** Heure UTC `AAAA-MM-JJTHH` ou jour UTC `AAAA-MM-JJ` ; vide dans les totaux. */
  slot: string;
}

/** Nombre d'appels d'un nom sur un créneau, avec les dimensions de la session appelante. */
export interface CallCountRow extends SessionDims {
  /** Heure UTC `AAAA-MM-JJTHH` ou jour UTC `AAAA-MM-JJ`, comme `SessionUsageRow.slot`. */
  slot: string;
  name: string;
  calls: number;
}

/** Résultat du lecteur des sessions. */
export interface SessionUsage {
  rows: SessionUsageRow[];
  /** Totaux sans créneau. */
  totals: SessionUsageRow[];
  /** Par nom d'outil. */
  tools: CallCountRow[];
  /** Par compétence ouverte. */
  skills: CallCountRow[];
  /** Par slug d'action Composio. */
  composio: CallCountRow[];
  /** Profils dont le state.db est illisible. */
  unreadable: string[];
}

/** Routine lue dans cron/jobs.json. */
export interface RoutineDefinition {
  id: string;
  /** Nom tel qu'écrit par Hermes. */
  name: string;
  enabled: boolean;
  /** Expression cron à cinq champs, ou date ISO pour une exécution unique. */
  schedule: string;
}

/** Configuration d'un profil ; une partie illisible vaut null. */
export interface ProfileSetup {
  routines: RoutineDefinition[] | null;
  /** Serveurs MCP déclarés dans config.yaml. */
  mcpServers: string[] | null;
}

/** Configuration de chaque profil. */
export interface InstanceSetup {
  profiles: Record<string, ProfileSetup>;
}

/** A tool declared in an expert's connecteurs.json, with the state the expert last saw. */
export interface ExpertConnector {
  nom: string;
  etat: string;
  note?: string;
}

export interface ExpertRoutines {
  expId: string;
  expertName: string;
  /** null when the routines could not be read. */
  routines: Routine[] | null;
}

export interface ExpertRoutineRuns {
  expId: string;
  expertName: string;
  routines: Array<{ id: string; name: string; enabled: boolean; runs: Array<{ at: number; outcome: RunOutcome | null }> }> | null;
}

/** A messaging channel switched on or configured on the instance, in its live state. */
export interface ChannelState {
  id: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  state: string | null;
}
