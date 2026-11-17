/** Dossiers sous le répertoire personnel (`~`). */
export const INSTANCE_DIRS = {
  hermes: ".hermes",
  yelema: ".yelema",
  deliverables: "Livrables",
} as const;

/** Fichiers d'un répertoire Hermes (`~/.hermes` ou `~/.hermes/profiles/<id>`). */
export const HERMES_FILES = {
  profiles: "profiles",
  stateDb: "state.db",
  cronJobs: "cron/jobs.json",
  cronAudit: "cron/usage_audit.jsonl",
  config: "config.yaml",
  soul: "SOUL.md",
  skills: "skills",
  memory: "memories/MEMORY.md",
} as const;

/** Fichiers de `~/.yelema`. */
export const YELEMA_FILES = {
  telegram: "telegram.json",
  mail: "mail.json",
  profiles: "profiles",
  connectors: "connecteurs.json",
  voiceBriefs: "voix",
  voiceBriefPrefix: "brief-",
} as const;

/** Chemin `~/…` pour l'API de fichiers de l'instance. */
export const homeFile = (...parts: string[]): string => ["~", ...parts].join("/");

/** Emplacements possibles du rapport de mémoire d'un jour (`AAAA-MM-JJ`), dans l'ordre de recherche. */
export const dailyReportFiles = (date: string): string[] => [
  homeFile(INSTANCE_DIRS.hermes, "memory", "daily", `${date}.md`),
  homeFile(INSTANCE_DIRS.yelema, "memory", "daily", `${date}.md`),
  homeFile(INSTANCE_DIRS.hermes, "memory", `${date}.md`),
  homeFile(INSTANCE_DIRS.deliverables, "_memoire", `daily-${date}.md`),
];

/** Profil du répertoire `~/.hermes` lui-même. */
export const HOME_PROFILE = "default";
/** Profil de Yélé. */
export const SUPERVISOR_PROFILE = "yele";
/** Profils qui ne sont pas des experts. */
export const NOT_EXPERTS: readonly string[] = [HOME_PROFILE, SUPERVISOR_PROFILE];

/** Nom enregistré par Hermes pour le modèle par défaut de l'instance. */
export const DEFAULT_MODEL = "default";

/** Valeurs de la colonne `source` d'une session. */
export const SESSION_SOURCES = {
  app: "agent37-gateway",
  routine: "cron",
  telegram: "telegram",
  whatsapp: "whatsapp",
  slack: "slack",
  discord: "discord",
  teams: "teams",
  googleChat: "google_chat",
  email: "email",
  oneShot: "oneshot",
  editor: "acp",
  cli: "cli",
  subagent: "subagent",
} as const;

/** Sources qui sont des canaux d'accès à l'agent. */
export const ACCESS_CHANNELS: readonly string[] = [
  SESSION_SOURCES.app,
  SESSION_SOURCES.telegram,
  SESSION_SOURCES.whatsapp,
  SESSION_SOURCES.slack,
  SESSION_SOURCES.discord,
  SESSION_SOURCES.teams,
  SESSION_SOURCES.googleChat,
  SESSION_SOURCES.email,
];

/** Id de session d'une routine `cron_<id>_<date>` ; le groupe capturé est l'id de la routine. */
export const ROUTINE_SESSION_PATTERN = "^cron_([0-9a-f]+)_";

/** Outil d'ouverture d'une compétence ; argument `name`. */
export const SKILL_VIEW_TOOL = "skill_view";
/** Outil Composio d'exécution d'actions ; argument `tools[].tool_slug`. */
export const COMPOSIO_EXECUTE_TOOL = "COMPOSIO_MULTI_EXECUTE_TOOL";
/** Préfixe des outils de Composio exposés par un serveur MCP. */
export const COMPOSIO_TOOL_PREFIX = "COMPOSIO_";
/** Nom d'un outil de serveur MCP : `mcp__<serveur>__<outil>` ; groupes capturés : serveur, outil. */
export const MCP_TOOL_PATTERN = /^mcp__(.+?)__(.+)$/;

/** Phase de telegram.json quand le groupe Telegram est prêt. */
export const TELEGRAM_READY_PHASE = "ready";

/** États d'un outil dans connecteurs.json. */
export const CONNECTOR_STATES = { ok: "ok", error: "erreur" } as const;

/** Fonctions Python placées en tête de chaque lecteur ; `L` contient les emplacements ci-dessus. */
export const HERMES_PY = String.raw`
import os as _os
L = P["layout"]

def home_path(*parts):
    return _os.path.join(_os.path.expanduser("~"), *parts)

def hermes_home():
    return home_path(L["dirs"]["hermes"])

def yelema_path(*parts):
    return home_path(L["dirs"]["yelema"], *parts)

def hermes_homes():
    """(profil, répertoire Hermes) : celui de l'instance, puis chaque profil par nom."""
    root = hermes_home()
    homes = [(L["homeProfile"], root)]
    base = _os.path.join(root, L["hermes"]["profiles"])
    if _os.path.isdir(base):
        for name in sorted(_os.listdir(base)):
            path = _os.path.join(base, name)
            if not name.startswith(".") and name != L["homeProfile"] and _os.path.isdir(path):
                homes.append((name, path))
    return homes

def expert_homes():
    """(expert, répertoire Hermes) pour les profils qui sont des experts."""
    return [(name, path) for name, path in hermes_homes() if name not in L["notExperts"]]

def read_json(path):
    """Contenu d'un fichier JSON, None s'il est absent ; lève une exception s'il est illisible."""
    if not _os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return _json.load(f)
`;

export interface InstanceReader {
  script: string;
  params: object;
}

/** Lecteur : fonctions communes + `script`, avec les emplacements dans ses paramètres. */
export function hermesReader(script: string, params: object = {}): InstanceReader {
  return { script: `${HERMES_PY.trim()}\n\n${script.trim()}`, params: { ...params, layout: readerLayout() } };
}

/** Emplacements transmis aux lecteurs Python dans `P["layout"]`. */
function readerLayout() {
  return {
    dirs: INSTANCE_DIRS,
    hermes: HERMES_FILES,
    yelema: YELEMA_FILES,
    homeProfile: HOME_PROFILE,
    notExperts: NOT_EXPERTS,
    routineSession: ROUTINE_SESSION_PATTERN,
    routineSource: SESSION_SOURCES.routine,
    skillViewTool: SKILL_VIEW_TOOL,
    composioExecuteTool: COMPOSIO_EXECUTE_TOOL,
    connectorStates: CONNECTOR_STATES,
  };
}
