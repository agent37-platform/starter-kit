// Lecteur des sessions : lit le state.db de chaque profil en lecture seule et renvoie
// - rows / totals : consommation par créneau (heure UTC sur `HOURLY_DAYS` jours, jour UTC avant),
//   profil, canal, modèle et routine, et au total ; répartition par modèle depuis session_model_usage ;
// - tools, skills, composio : nombre d'appels par créneau (comme rows), profil, canal, modèle et routine
//   de la session, et nom de l'outil, de la compétence ou de l'action Composio.
// Un profil illisible n'est pas compté et figure dans `unreadable`.

import { hermesReader, type InstanceReader } from "../hermes-layout.ts";
import { METRIC_KEYS } from "./usage.ts";

/** Profondeur en jours des chiffres par créneau et par jour. */
export const KEEP_DAYS = 92;
/** Nombre de jours UTC, aujourd'hui compris, détaillés heure par heure. */
export const HOURLY_DAYS = 2;

const SCRIPT = String.raw`
import sqlite3, time, re
from urllib.parse import quote
METRICS = P["metrics"]
KEEP_FROM = time.time() - P["keepDays"] * 86400
HOURLY_FROM = (int(time.time() // 86400) - (P["hourlyDays"] - 1)) * 86400
ROUTINE_SESSION = re.compile(L["routineSession"])
SKILL_VIEW, COMPOSIO_EXECUTE = L["skillViewTool"], L["composioExecuteTool"]
SESSION = ["id", "started_at", "ended_at", "source", "model", "message_count", "tool_call_count",
           "api_call_count", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
           "reasoning_tokens"]
PER_MODEL = ["session_id", "model", "api_call_count", "input_tokens", "output_tokens", "cache_read_tokens",
             "cache_write_tokens", "reasoning_tokens", "first_seen"]
NO_SESSION = ("", "", "")

def num(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0

def slot_of(t):
    return time.strftime("%Y-%m-%dT%H" if t >= HOURLY_FROM else "%Y-%m-%d", time.gmtime(t))

def select(c, table, wanted, where="", args=()):
    # Une colonne absente est lue comme NULL.
    cols = {r[1] for r in c.execute("PRAGMA table_info(%s)" % table)}
    if not cols:
        return []
    q = "SELECT %s FROM %s %s" % (", ".join(n if n in cols else "NULL" for n in wanted), table, where)
    return [dict(zip(wanted, r)) for r in c.execute(q, args)]

def spend(r):
    return {
        "apiCalls": num(r["api_call_count"]),
        "inputTokens": num(r["input_tokens"]),
        "outputTokens": num(r["output_tokens"]),
        "cacheReadTokens": num(r["cache_read_tokens"]),
        "cacheWriteTokens": num(r["cache_write_tokens"]),
        "reasoningTokens": num(r["reasoning_tokens"]),
    }

def per_model(s, parts):
    # Répartit la session par modèle selon session_model_usage ; l'excédent du total de la session
    # est attribué au modèle de la session.
    own, main_model = spend(s), s["model"] or ""
    out = {}
    for p in parts:
        acc = out.setdefault(p["model"] or main_model, dict.fromkeys(own, 0))
        for k, v in spend(p).items():
            acc[k] += v
    main = out.setdefault(main_model, dict.fromkeys(own, 0))
    for k, v in own.items():
        rest = v - sum(o[k] for o in out.values())
        if rest > 1e-9:
            main[k] += rest
    return out

class Profile:
    """Chiffres d'un profil, fusionnés une fois le profil entièrement lu."""

    def __init__(self, name):
        self.name = name
        self.rows, self.totals = {}, {}
        self.tools, self.skills, self.composio = {}, {}, {}
        self.dims = {}

    def add(self, acc, key, m):
        cur = acc.setdefault(key, dict.fromkeys(METRICS, 0))
        for k in METRICS:
            cur[k] += m.get(k, 0)

    def count(self, acc, slot, sid, name):
        key = (slot, self.name) + self.dims.get(sid, NO_SESSION) + (name,)
        acc[key] = acc.get(key, 0) + 1

    def spent(self, at, dims, row):
        self.add(self.totals, (self.name,) + dims, row)
        if at >= KEEP_FROM:
            self.add(self.rows, (slot_of(at), self.name) + dims, row)

    def read_sessions(self, c):
        parts = {}
        for p in select(c, "session_model_usage", PER_MODEL):
            parts.setdefault(p["session_id"], []).append(p)
        sessions = select(c, "sessions", SESSION)
        # Appels d'une session absente de la table sessions : comptés sans canal ni routine, à leur date.
        known = {s["id"] for s in sessions}
        for sid, ps in parts.items():
            if sid not in known:
                for p in ps:
                    self.spent(num(p["first_seen"]), ("", p["model"] or "", ""), spend(p))
        for s in sessions:
            started, ended = num(s["started_at"]), num(s["ended_at"])
            source, model = s["source"] or "", s["model"] or ""
            match = ROUTINE_SESSION.match(s["id"] or "") if source == L["routineSource"] else None
            routine = match.group(1) if match else ""
            self.dims[s["id"]] = (source, model, routine)
            own = {
                "sessions": 1,
                "messages": num(s["message_count"]),
                "toolCalls": num(s["tool_call_count"]),
                "durationMs": (ended - started) * 1000 if ended > started > 0 else 0,
            }
            for m, figures in per_model(s, parts.get(s["id"], [])).items():
                self.spent(started, (source, m, routine), dict(figures, **(own if m == model else {})))

    def read_calls(self, c):
        for m in select(c, "messages", ["session_id", "tool_name", "timestamp"], "WHERE tool_name IS NOT NULL AND tool_name != '' AND timestamp >= ?", (KEEP_FROM,)):
            self.count(self.tools, slot_of(num(m["timestamp"])), m["session_id"], m["tool_name"])
        where = "WHERE timestamp >= ? AND (instr(tool_calls, ?) > 0 OR instr(tool_calls, ?) > 0)"
        for m in select(c, "messages", ["session_id", "tool_calls", "timestamp"], where, (KEEP_FROM, SKILL_VIEW, COMPOSIO_EXECUTE)):
            slot = slot_of(num(m["timestamp"]))
            try:
                calls = _json.loads(m["tool_calls"] or "[]")
            except ValueError:
                continue
            for call in calls if isinstance(calls, list) else []:
                fn = call.get("function") if isinstance(call, dict) else None
                if not isinstance(fn, dict):
                    continue
                name, args = fn.get("name") or "", fn.get("arguments")
                try:
                    args = _json.loads(args) if isinstance(args, str) else args
                except ValueError:
                    continue
                if not isinstance(args, dict):
                    continue
                if name == SKILL_VIEW and isinstance(args.get("name"), str):
                    self.count(self.skills, slot, m["session_id"], args["name"])
                elif name.endswith(COMPOSIO_EXECUTE):
                    for t in args.get("tools") or []:
                        if isinstance(t, dict) and isinstance(t.get("tool_slug"), str):
                            self.count(self.composio, slot, m["session_id"], t["tool_slug"])

rows, totals, tools, skills, composio, unreadable = {}, {}, {}, {}, {}, []

def merge(into, acc):
    for k, v in acc.items():
        if isinstance(v, dict):
            cur = into.setdefault(k, dict.fromkeys(METRICS, 0))
            for m in METRICS:
                cur[m] += v[m]
        else:
            into[k] = into.get(k, 0) + v

for name, home in hermes_homes():
    db = _os.path.join(home, L["hermes"]["stateDb"])
    if not _os.path.exists(db):
        continue
    p = Profile(name)
    try:
        c = sqlite3.connect("file:%s?mode=ro" % quote(db), uri=True, timeout=5)
        try:
            p.read_sessions(c)
            p.read_calls(c)
        finally:
            c.close()
    except Exception:
        unreadable.append(name)
        continue
    for into, acc in ((rows, p.rows), (totals, p.totals), (tools, p.tools), (skills, p.skills), (composio, p.composio)):
        merge(into, acc)

figures = lambda acc: [list(k) + [acc[k][m] for m in METRICS] for k in acc]
counts = lambda acc: [list(k) + [n] for k, n in acc.items()]
emit({
    "rows": figures(rows),
    "totals": figures(totals),
    "tools": counts(tools),
    "skills": counts(skills),
    "composio": counts(composio),
    "unreadable": unreadable,
})
`;

export const sessionUsageReader = (): InstanceReader =>
  hermesReader(SCRIPT, { metrics: METRIC_KEYS, keepDays: KEEP_DAYS, hourlyDays: HOURLY_DAYS });
