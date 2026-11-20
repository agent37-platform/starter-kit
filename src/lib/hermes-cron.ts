import "server-only";
import { parse } from "yaml";
import { agent37, instanceFetch, instancePortFetch } from "@/lib/agent37";
import { ApiError } from "@/lib/http";
import { composePrompt, splitPrompt, summarize, type Routine } from "@/lib/routines";
import { runPool } from "@/lib/bulk";
import { parseGoals, type Goal } from "@/lib/objectifs";
import type { NightTask } from "@/lib/nuit";
import { currentInstance } from "@/lib/session";

// Hermes's own scheduler: each expert's routines live in its profile, the instance's gateway runs
// them ONLY while the instance is awake (instances sleep after 45 idle minutes, so a routine due
// during a sleep is missed; see docs/plans/experts-profils-vercel.md § 10), and each run is a conversation under the expert plus a
// message on the chats the run delivers to. We drive it through Hermes's API server, its documented
// programmatic API, whose Jobs API serves each expert at /p/<expert>/api/jobs. The yelema-hermes image
// turns it on, on port 8642, reached on the instance's preview URL; this module is the only one that
// speaks it.
//
// Two keys guard it: ours at the Agent37 edge, then Hermes's own API_SERVER_KEY, which the image
// makes once per instance in ~/.yelema/api-server-key. It is read from there through the files API
// and kept per instance until refused.
const API_PORT = 8642;
const KEY_FILE = "~/.yelema/api-server-key";
// The default profile's config, where the experts' Telegram routes live (lib/telegram-topics).
const CONFIG_FILE = "~/.hermes/config.yaml";
const keys = new Map<string, string>();

const UNAVAILABLE = "Les routines ne répondent pas pour l’instant. Réessayez dans un instant.";

const fileQuery = (path: string) => `/v1/files/content?path=${encodeURIComponent(path)}`;

async function apiKey(agentId: string): Promise<string> {
  const cached = keys.get(agentId);
  if (cached) return cached;
  const res = await instanceFetch(agentId, fileQuery(KEY_FILE), { signal: AbortSignal.timeout(30_000) });
  const key = res.ok ? (await res.text()).trim() : "";
  if (!key) {
    await res.body?.cancel().catch(() => undefined);
    // No key: an instance on a yelema-hermes image older than the API server (revision 4).
    console.error(`[routines] no API server key on ${agentId}`, res.status);
    throw new ApiError(502, "routines_unavailable", UNAVAILABLE);
  }
  keys.set(agentId, key);
  return key;
}

// Hermes accepts /p/<expert>/ only with the key written in THAT profile's .env, and the image
// writes it into each profile when the instance starts. A profile installed afterwards (the back
// office installs the experts once the instance is up) has none, and its routines answer 401 until
// the next start. The image's own script puts the key where it is missing; it changes nothing else
// and can be run any number of times. At most once every few minutes per instance, so a refusal
// that it does not cure is not answered with a command on every page.
const KEY_SCRIPT =
  '"${HERMES_PYTHON:-/usr/local/lib/hermes/hermes-agent/venv/bin/python}" /usr/local/bin/yelema-api-server.py';
const SPREAD_EVERY_MS = 5 * 60_000;
const spreadAt = new Map<string, number>();

async function spreadKey(agentId: string): Promise<void> {
  if (Date.now() - (spreadAt.get(agentId) ?? 0) < SPREAD_EVERY_MS) return;
  spreadAt.set(agentId, Date.now());
  try {
    const result = await agent37.exec(agentId, KEY_SCRIPT);
    if (result.exit_code !== 0) console.error(`[routines] key script failed on ${agentId}`, result.stderr.slice(0, 500));
  } catch (e) {
    console.error(`[routines] key script unreachable on ${agentId}:`, e instanceof Error ? e.message : e);
  }
}

// Hermes's reason for refusing a routine ({"error": "..."}), in the form's words.
function rejection(text: string): string {
  let reason = "";
  try {
    reason = String(JSON.parse(text).error ?? "");
  } catch {}
  if (reason.startsWith("Prompt must be")) return "La description est trop longue : 5 000 caractères au plus.";
  if (reason.startsWith("Blocked")) {
    return "La description contient un passage que les routines refusent. Reformulez-la, puis réessayez.";
  }
  return "La routine n’a pas pu être enregistrée. Vérifiez l’horaire, puis réessayez.";
}

// A member of a team instance never holds the instance's key: the runtime gateway adds it for their
// own experts' routines only.
async function onSeat(agentId: string): Promise<boolean> {
  const instance = await currentInstance().catch(() => null);
  return instance?.id === agentId && Boolean(instance.seat);
}

async function hermes<T>(agentId: string, method: string, path: string, body?: unknown): Promise<T> {
  const seat = await onSeat(agentId);
  for (let attempt = 0; ; attempt++) {
    const res = await instancePortFetch(agentId, API_PORT, path, {
      method,
      headers: {
        ...(seat ? {} : { Authorization: `Bearer ${await apiKey(agentId)}` }),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    // The instance got a new key (a fresh home), or this expert's profile never got it: read the
    // key again and have the instance hand it to every profile, once.
    if (res.status === 401 && attempt === 0 && !seat) {
      keys.delete(agentId);
      await res.body?.cancel().catch(() => undefined);
      await spreadKey(agentId);
      continue;
    }
    const text = await res.text();
    if (res.ok) return (text ? JSON.parse(text) : {}) as T;
    console.error(`[routines] ${method} ${path} on ${agentId}: ${res.status}`, text.slice(0, 500));
    if (res.status === 404) throw new ApiError(404, "not_found", "Cette routine n’existe plus.");
    if (res.status === 400) throw new ApiError(400, "invalid_request", rejection(text));
    throw new ApiError(502, "routines_unavailable", UNAVAILABLE);
  }
}

interface HermesJob {
  id: string;
  name?: string | null;
  prompt?: string | null;
  enabled: boolean;
  state?: string;
  paused_reason?: string | null;
  last_run_at?: string | null;
  next_run_at?: string | null;
  deliver?: string | null;
  schedule: { kind: string; expr?: string; run_at?: string; display?: string };
}

interface Route {
  platform?: string;
  chat_id?: string | number;
  thread_id?: string | number | null;
  profile?: string;
}

// The reason Hermes gives the routines it installs with an expert, paused until someone turns them on.
const SHIPPED = "Installed from a profile distribution";

const jobsPath = (profile: string, rest = "") => `/p/${encodeURIComponent(profile)}/api/jobs${rest}`;
const jobPath = (profile: string, id: string, action = "") => jobsPath(profile, `/${encodeURIComponent(id)}${action}`);

function toRoutine(job: HermesJob, expertName: string): Routine {
  const { task, skills, attachment } = splitPrompt(job.prompt ?? "");
  const schedule = job.schedule.kind === "once" ? job.schedule.run_at ?? "" : job.schedule.expr ?? job.schedule.display ?? "";
  return {
    id: job.id,
    // The experts' own routines carry their name: "Point Tresorerie Hebdo (Mamadou)".
    name: (job.name ?? "").replace(` (${expertName})`, "").trim() || summarize(task),
    task,
    summary: summarize(task),
    skills,
    attachment,
    schedule,
    enabled: job.enabled,
    suggested: !job.enabled && !job.last_run_at && (job.paused_reason ?? "").startsWith(SHIPPED),
    lastRunAt: job.last_run_at ?? null,
    deliver: job.deliver ?? null,
    nextRunAt: job.enabled ? (job.next_run_at ?? null) : null,
  };
}

export interface RoutineFields {
  name: string;
  prompt: string;
  schedule: string;
}

export const hermesCron = {
  list: async (agentId: string, profile: string, expertName: string): Promise<Routine[]> => {
    const { jobs } = await hermes<{ jobs: HermesJob[] }>(agentId, "GET", jobsPath(profile, "?include_disabled=true"));
    return jobs.map((j) => toRoutine(j, expertName));
  },

  create: async (agentId: string, profile: string, expertName: string, fields: RoutineFields): Promise<Routine> => {
    const deliver = await deliveryFor(agentId, profile);
    const { job } = await hermes<{ job: HermesJob }>(agentId, "POST", jobsPath(profile), { ...fields, deliver });
    return toRoutine(job, expertName);
  },

  update: async (agentId: string, profile: string, expertName: string, id: string, fields: RoutineFields) => {
    const [{ job: current }, deliver] = await Promise.all([
      hermes<{ job: HermesJob }>(agentId, "GET", jobPath(profile, id)),
      deliveryFor(agentId, profile),
    ]);
    // The form sends the whole prompt back. Hermes's own is left alone when it did not change: an
    // expert's own routines can be longer than Hermes lets a client write.
    const was = splitPrompt(current.prompt ?? "");
    const { prompt, ...rest } = fields;
    const changes = prompt === composePrompt(was.task, was.skills, was.attachment) ? rest : fields;
    const { job } = await hermes<{ job: HermesJob }>(agentId, "PATCH", jobPath(profile, id), { ...changes, deliver });
    return toRoutine(job, expertName);
  },

  // Turning a routine on also points it at the expert's chats as they are today.
  setEnabled: async (agentId: string, profile: string, expertName: string, id: string, enabled: boolean) => {
    if (enabled) {
      const deliver = await deliveryFor(agentId, profile);
      await hermes<{ job: HermesJob }>(agentId, "PATCH", jobPath(profile, id), { deliver });
    }
    const { job } = await hermes<{ job: HermesJob }>(agentId, "POST", jobPath(profile, id, enabled ? "/resume" : "/pause"));
    return toRoutine(job, expertName);
  },

  // The name Hermes gives the routine's runs (their conversations are titled after it).
  hermesName: async (agentId: string, profile: string, id: string): Promise<string> => {
    const { job } = await hermes<{ job: HermesJob }>(agentId, "GET", jobPath(profile, id));
    return job.name ?? "";
  },

  // The expert's objectives, read-only (image I68); null on an image without them (404).
  objectifs: async (agentId: string, profile: string): Promise<Goal[] | null> => {
    try {
      return parseGoals(await hermes<unknown>(agentId, "GET", `/p/${encodeURIComponent(profile)}/api/objectifs`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },

  // The expert's Kanban tasks of the last hours, read-only (image I79), for « Cette nuit »; null on an image without them (404).
  taches: async (agentId: string, profile: string, heures = 36): Promise<NightTask[] | null> => {
    try {
      const body = await hermes<{ taches?: unknown }>(agentId, "GET", `/p/${encodeURIComponent(profile)}/api/taches?heures=${heures}`);
      return Array.isArray(body.taches) ? (body.taches as NightTask[]) : [];
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },

  remove: (agentId: string, profile: string, id: string) =>
    hermes<{ ok: boolean }>(agentId, "DELETE", jobPath(profile, id)),

  // Hermes's own "run now": the routine is due at once, and the gateway's scheduler runs it at its
  // next tick, within a minute, like a scheduled run, so the result reaches the expert's chats. It also
  // turns a paused routine on and would spend a one-off: only for a routine that is on and repeats.
  runNow: async (agentId: string, profile: string, id: string) => {
    const { job } = await hermes<{ job: HermesJob }>(agentId, "GET", jobPath(profile, id));
    if (!job.enabled || job.schedule.kind === "once") {
      throw new ApiError(409, "not_runnable", "Seule une routine active et récurrente se lance à la demande.");
    }
    await hermes<{ job: HermesJob }>(agentId, "POST", jobPath(profile, id, "/run"));
  },
};

// Where an expert's routines post their result: every chat routed to the expert (its Telegram topic),
// or only the app ("local": the run is still a conversation under the expert) when there is none.
async function deliveries(agentId: string): Promise<(profile: string) => string> {
  const res = await instanceFetch(agentId, fileQuery(CONFIG_FILE), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    console.error(`[routines] could not read the Hermes config on ${agentId}`, res.status);
    throw new ApiError(502, "routines_unavailable", UNAVAILABLE);
  }
  const config = parse(await res.text()) as { gateway?: { profile_routes?: Route[] } } | null;
  const routes = config?.gateway?.profile_routes ?? [];
  return (profile) => {
    const targets = routes
      .filter((r) => r.profile === profile && r.platform && r.chat_id)
      .map((r) => [r.platform, r.chat_id, r.thread_id].filter((p) => p !== undefined && p !== null && p !== "").join(":"));
    return targets.length ? [...new Set(targets)].join(",") : "local";
  };
}

async function deliveryFor(agentId: string, profile: string): Promise<string> {
  return (await deliveries(agentId))(profile);
}

// After the experts' Telegram topics are created: routines that posted nowhere but the app now post
// to their expert's topic too.
export async function repointRoutines(agentId: string, profiles: string[]): Promise<void> {
  const deliverFor = await deliveries(agentId);
  // The experts side by side (each its own jobs), three at a time; one expert's jobs one by one.
  const done = await runPool(profiles, 3, async (profile) => {
    const deliver = deliverFor(profile);
    if (deliver === "local") return;
    const { jobs } = await hermes<{ jobs: HermesJob[] }>(agentId, "GET", jobsPath(profile, "?include_disabled=true"));
    for (const job of jobs) {
      if (job.deliver && job.deliver !== "local" && job.deliver !== "origin") continue;
      await hermes<{ job: HermesJob }>(agentId, "PATCH", jobPath(profile, job.id), { deliver });
    }
  });
  const failed = done.find((r) => r.status === "rejected");
  if (failed) throw (failed as PromiseRejectedResult).reason;
}
