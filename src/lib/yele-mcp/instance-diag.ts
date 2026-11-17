// Lecteur des fichiers de Yelema : Telegram, adresses e-mail, échecs des routines, connecteurs et
// compétences des experts, briefs vocaux. Les textes lus sont masqués de leurs secrets.

import { hermesReader, type InstanceReader } from "./hermes-layout.ts";
import { masquerSecrets } from "./secrets.ts";
import { KEEP_DAYS } from "./session-usage/command.ts";
import type { ExpertConnector, ExpertSkillInfo, IncidentAlertData, InstanceDiag, MailConfig, TelegramConfig, VoiceBriefInfo } from "./types.ts";

/** Champs lus dans telegram.json et mail.json. */
const TELEGRAM_FIELDS = ["bot", "botId", "chatTitle", "chatId", "phase", "inviteLink", "topics"] as const satisfies readonly (keyof TelegramConfig)[];
const MAIL_FIELDS = ["addresses"] as const satisfies readonly (keyof MailConfig)[];

const SCRIPT = String.raw`
import time
KEEP_FROM = time.strftime("%Y-%m-%d", time.gmtime(time.time() - P["keepDays"] * 86400))
STATES = L["connectorStates"]
unreadable = []

def attempt(what, read, *args):
    try:
        return read(*args)
    except Exception:
        unreadable.append(what)
        return None

def picked(data, fields):
    return {k: data[k] for k in fields if k in data} if isinstance(data, dict) else None

def audit(expert, home):
    out = {"runs": 0, "errors": 0, "byDay": {}, "incidents": []}
    path = _os.path.join(home, L["hermes"]["cronAudit"])
    if not _os.path.exists(path):
        return out
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            out["runs"] += 1
            try:
                row = _json.loads(line)
            except ValueError:
                continue
            if not isinstance(row, dict) or not row.get("error"):
                continue
            out["errors"] += 1
            ts = row.get("ts") if isinstance(row.get("ts"), str) else ""
            if ts[:10] >= KEEP_FROM:
                out["byDay"][ts[:10]] = out["byDay"].get(ts[:10], 0) + 1
                out["incidents"].append({"type": "CRON_ERROR", "expert": expert, "ts": ts, "model": str(row.get("model") or ""), "error": str(row["error"])})
    return out

def connectors(expert):
    data = read_json(yelema_path(L["yelema"]["profiles"], expert, L["yelema"]["connectors"]))
    tools = data.get("outils") if isinstance(data, dict) else None
    out = []
    for o in tools if isinstance(tools, list) else []:
        if isinstance(o, dict) and isinstance(o.get("nom"), str) and o["nom"]:
            out.append({"nom": o["nom"], "etat": str(o.get("etat") or ""), "note": o["note"] if isinstance(o.get("note"), str) else None})
    return out

def skills(expert, home):
    root = _os.path.join(home, L["hermes"]["skills"])
    if not _os.path.isdir(root):
        return {"expId": expert, "specific": [], "shared": []}
    dirs = [e for e in sorted(_os.listdir(root)) if not e.startswith(".") and _os.path.isdir(_os.path.join(root, e))]
    own = next((d for d in dirs if d.lower() == expert.lower()), None)
    specific = sorted(e for e in _os.listdir(_os.path.join(root, own)) if not e.startswith(".")) if own else []
    return {"expId": expert, "specific": specific, "shared": [d for d in dirs if d != own]}

def voice_briefs():
    root = yelema_path(L["yelema"]["voiceBriefs"])
    prefix = L["yelema"]["voiceBriefPrefix"]
    out = []
    for name in sorted(_os.listdir(root)) if _os.path.isdir(root) else []:
        if name.startswith(prefix) and name.endswith(".json"):
            b = attempt(name, read_json, _os.path.join(root, name))
            if isinstance(b, dict):
                out.append({"expId": name[len(prefix):-len(".json")], "at": b.get("at"), "text": b.get("text") or ""})
    return out

experts = expert_homes()
routine_errors, errors_by_day, expert_connectors, expert_skills = {}, {}, {}, []
incidents, warnings, runs = [], [], 0
for expert, home in experts:
    a = attempt("audit:" + expert, audit, expert, home)
    if a:
        runs += a["runs"]
        if a["errors"]:
            routine_errors[expert] = a["errors"]
        for day, n in a["byDay"].items():
            errors_by_day.setdefault(day, {})[expert] = n
        incidents += a["incidents"]
    tools = attempt("connecteurs:" + expert, connectors, expert)
    if tools is not None:
        expert_connectors[expert] = tools
        for t in tools:
            if t["etat"] == STATES["error"]:
                incidents.append({"type": "CONNECTOR_ERROR", "expert": expert, "outil": t["nom"], "note": t["note"]})
            elif t["etat"] != STATES["ok"]:
                warnings.append({"type": "CONNECTOR_WARNING", "expert": expert, "outil": t["nom"], "etat": t["etat"]})
    s = attempt("compétences:" + expert, skills, expert, home)
    if s:
        expert_skills.append(s)

telegram = picked(attempt("telegram", read_json, yelema_path(L["yelema"]["telegram"])), P["telegramFields"])
emit({
    "telegram": telegram,
    "mail": picked(attempt("mail", read_json, yelema_path(L["yelema"]["mail"])), P["mailFields"]),
    "routineErrors": routine_errors,
    "routineErrorsByDay": errors_by_day,
    "connectors": expert_connectors,
    "skills": expert_skills,
    "voiceBriefs": attempt("voix", voice_briefs) or [],
    "alerts": {
        "incidents": incidents,
        "avertissements": warnings,
        "totalCronsScanned": runs,
        "telegramPhase": telegram.get("phase") if isinstance(telegram, dict) and isinstance(telegram.get("phase"), str) else None,
    },
    "unreadable": unreadable,
})
`;

export const instanceDiagReader = (): InstanceReader =>
  hermesReader(SCRIPT, { keepDays: KEEP_DAYS, telegramFields: TELEGRAM_FIELDS, mailFields: MAIL_FIELDS });

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const masked = (v: unknown): string | undefined => (typeof v === "string" ? masquerSecrets(v) : undefined);
const counts = (v: unknown): Record<string, number> =>
  isObj(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => Number.isFinite(e[1]))) : {};
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

function telegramOf(v: unknown): TelegramConfig | null {
  if (!isObj(v)) return null;
  const topics = isObj(v.topics) ? Object.fromEntries(Object.entries(v.topics).filter((e): e is [string, string] => typeof e[1] === "string")) : undefined;
  return {
    bot: str(v.bot),
    botId: typeof v.botId === "number" ? v.botId : undefined,
    chatTitle: str(v.chatTitle),
    chatId: typeof v.chatId === "number" ? v.chatId : undefined,
    phase: str(v.phase),
    inviteLink: str(v.inviteLink),
    topics,
  };
}

function mailOf(v: unknown): MailConfig | null {
  if (!isObj(v) || !isObj(v.addresses)) return null;
  return { addresses: Object.fromEntries(Object.entries(v.addresses).filter((e): e is [string, string] => typeof e[1] === "string")) };
}

function alertsOf(v: unknown): IncidentAlertData {
  const a = isObj(v) ? v : {};
  return {
    incidents: list(a.incidents).map((i) => ({
      type: str(i.type) ?? "",
      expert: str(i.expert) ?? "",
      ts: str(i.ts),
      model: str(i.model),
      error: masked(i.error),
      outil: str(i.outil),
      note: masked(i.note),
    })),
    avertissements: list(a.avertissements).map((w) => ({ type: str(w.type) ?? "", expert: str(w.expert) ?? "", outil: str(w.outil), etat: str(w.etat) })),
    totalCronsScanned: typeof a.totalCronsScanned === "number" ? a.totalCronsScanned : 0,
    telegramPhase: str(a.telegramPhase) ?? null,
  };
}

/** Valide le résultat du lecteur champ par champ ; lève une exception si sa forme est inattendue. */
export function parseInstanceDiag(json: string): InstanceDiag {
  const raw = JSON.parse(json) as unknown;
  if (!isObj(raw) || !isObj(raw.alerts)) throw new Error("sortie inattendue");
  const byDay = isObj(raw.routineErrorsByDay) ? raw.routineErrorsByDay : {};
  return {
    telegram: telegramOf(raw.telegram),
    mail: mailOf(raw.mail),
    routineErrors: counts(raw.routineErrors),
    routineErrorsByDay: Object.fromEntries(Object.entries(byDay).map(([day, perExpert]) => [day, counts(perExpert)])),
    connectors: isObj(raw.connectors)
      ? Object.fromEntries(
          Object.entries(raw.connectors).map(([exp, tools]): [string, ExpertConnector[]] => [
            exp,
            list(tools).map((t) => ({ nom: str(t.nom) ?? "", etat: str(t.etat) ?? "", note: masked(t.note) })),
          ])
        )
      : {},
    skills: list(raw.skills).map((s): ExpertSkillInfo => ({ expId: str(s.expId) ?? "", specific: strings(s.specific), shared: strings(s.shared) })),
    voiceBriefs: list(raw.voiceBriefs).map((b): VoiceBriefInfo => ({ expId: str(b.expId) ?? "", at: str(b.at), text: masked(b.text) ?? "" })),
    alerts: alertsOf(raw.alerts),
    unreadable: strings(raw.unreadable),
  };
}
