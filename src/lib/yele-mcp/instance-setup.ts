// Lecteur de la configuration de chaque profil : routines (cron/jobs.json) et serveurs MCP
// (config.yaml). Une partie illisible vaut null.

import { hermesReader, type InstanceReader } from "./hermes-layout.ts";
import type { InstanceSetup, ProfileSetup, RoutineDefinition } from "./types.ts";

const SCRIPT = String.raw`
try:
    import yaml
except ImportError:
    yaml = None

def schedule(s):
    if isinstance(s, dict):
        return str((s.get("run_at") if s.get("kind") == "once" else s.get("expr") or s.get("display")) or "")
    return str(s or "")

def routines(home):
    data = read_json(_os.path.join(home, L["hermes"]["cronJobs"]))
    if data is None:
        return []
    jobs = data.get("jobs", []) if isinstance(data, dict) else data
    return [[str(j["id"]), str(j.get("name") or ""), j.get("enabled") is True, schedule(j.get("schedule"))]
            for j in jobs if isinstance(j, dict) and j.get("id")]

def mcp_servers(home):
    path = _os.path.join(home, L["hermes"]["config"])
    if not _os.path.exists(path):
        return []
    if yaml is None:
        raise RuntimeError("yaml")
    with open(path, encoding="utf-8") as f:
        servers = (yaml.safe_load(f) or {}).get("mcp_servers") or {}
    return sorted(str(k) for k in servers) if isinstance(servers, dict) else []

def attempt(read, home):
    try:
        return read(home)
    except Exception:
        return None

emit({"profiles": {name: {"routines": attempt(routines, home), "mcpServers": attempt(mcp_servers, home)} for name, home in hermes_homes()}})
`;

export const instanceSetupReader = (): InstanceReader => hermesReader(SCRIPT);

const str = (v: unknown) => (typeof v === "string" ? v : "");

function routineOf(r: unknown): RoutineDefinition | null {
  if (!Array.isArray(r) || !str(r[0])) return null;
  return { id: str(r[0]), name: str(r[1]), enabled: r[2] === true, schedule: str(r[3]) };
}

function profileOf(p: unknown): ProfileSetup {
  const raw = (p ?? {}) as { routines?: unknown; mcpServers?: unknown };
  return {
    routines: Array.isArray(raw.routines) ? raw.routines.map(routineOf).filter((r): r is RoutineDefinition => r !== null) : null,
    mcpServers: Array.isArray(raw.mcpServers) ? raw.mcpServers.filter((s): s is string => typeof s === "string") : null,
  };
}

/** Valide le résultat du lecteur ; lève une exception si sa forme est inattendue. */
export function parseInstanceSetup(json: string): InstanceSetup {
  const raw = JSON.parse(json) as { profiles?: unknown };
  if (!raw.profiles || typeof raw.profiles !== "object" || Array.isArray(raw.profiles)) throw new Error("sortie inattendue");
  return { profiles: Object.fromEntries(Object.entries(raw.profiles).map(([name, p]) => [name, profileOf(p)])) };
}
