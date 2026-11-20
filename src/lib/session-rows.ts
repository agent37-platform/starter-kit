import type { ChatSession } from "../components/chat/types.ts";
import type { RoutineSession } from "./activity.ts";
import { DEFAULT_PROFILE, isProfileId } from "./profile-id.ts";
import { isMemoryRun, routineOfSession, type RunOutcome } from "./routines.ts";
import { sessionTitle } from "./session-title.ts";
import { isSystemSession } from "./system-sessions.ts";
import type { SessionSummary } from "./types.ts";
import { callStartOf, callTitle, isCallSession, isVoiceSession } from "./voice-sessions.ts";

// An instance's session listing turned into what the app shows: the rail of one space and its routine
// runs for the bell. Shared by the per-profile and the grouped reads. No `@/` imports: tested.

export const RUNS_PER_PROFILE = 20;
export type Outcomes = ReadonlyMap<string, RunOutcome>;

const activeAt = (s: SessionSummary) => s.last_active ?? s.started_at ?? 0;

/** The rail: a routine run is a conversation only once it is known to have delivered. */
export function railOf(data: readonly SessionSummary[], outcomes: Outcomes): ChatSession[] {
  return data
    .filter((s) => (isCallSession(s.preview) || !isVoiceSession(s.preview)) && !isMemoryRun(s) && !isSystemSession(s))
    .filter((s) => routineOfSession(s) === null || outcomes.get(s.id) === "sent")
    .map((s) => ({
      session_id: s.id,
      // A call's conversation is named by its date, not by its transcript's first words.
      title: isCallSession(s.preview) ? callTitle(callStartOf(s.preview) ?? (s.started_at ? s.started_at * (s.started_at < 1e12 ? 1000 : 1) : null)) : sessionTitle(s.title, s.preview),
      last_active: activeAt(s),
      routine: routineOfSession(s),
    }))
    .sort((a, b) => b.last_active - a.last_active);
}

/** The latest routine runs, newest first; a run whose outcome is not read yet is `pending`. */
export function runsOf(data: readonly SessionSummary[], outcomes: Outcomes, max = RUNS_PER_PROFILE): RoutineSession[] {
  return data
    .filter((s) => !isMemoryRun(s) && !isSystemSession(s))
    .flatMap((s) => {
      const routine = routineOfSession(s);
      if (routine === null) return [];
      const o = outcomes.get(s.id);
      return [{ session_id: s.id, routine, last_active: activeAt(s), message_count: s.message_count ?? null, ...(o ? { silent: o !== "sent" } : { silent: false, pending: true as const }) }];
    })
    .sort((a, b) => b.last_active - a.last_active)
    .slice(0, max);
}

export interface ProfileListing {
  sessions: SessionSummary[];
  outcomes: Map<string, RunOutcome>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const OUTCOMES = new Set<string>(["sent", "silent", "failed"]);

function listingOf(v: unknown): ProfileListing | null {
  if (!isObj(v)) return null;
  const raw = Array.isArray(v.sessions) ? v.sessions : isObj(v.sessions) && Array.isArray(v.sessions.data) ? v.sessions.data : null;
  if (!raw) return null;
  const sessions = raw.filter((s): s is SessionSummary => isObj(s) && typeof s.id === "string" && s.id.length > 0);
  const r = isObj(v.routines) && isObj(v.routines.outcomes) ? v.routines.outcomes : v.routines;
  const outcomes = new Map<string, RunOutcome>();
  if (isObj(r)) for (const [id, o] of Object.entries(r)) if (typeof o === "string" && OUTCOMES.has(o)) outcomes.set(id, o as RunOutcome);
  return { sessions, outcomes };
}

/** The gateway's `sessions/by-profile` answer (contract §3), by profile; a malformed entry is left out. */
export function parseByProfile(body: unknown): Map<string, ProfileListing> {
  const out = new Map<string, ProfileListing>();
  const data = isObj(body) && isObj(body.data) ? body.data : null;
  if (!data) return out;
  for (const [profile, v] of Object.entries(data)) {
    const l = isProfileId(profile) ? listingOf(v) : null;
    if (l) out.set(profile, l);
  }
  return out;
}

/** The store's key for a space's profile: "" is the instance's own home. */
export const spaceProfile = (profile: string | null | undefined): string => (!profile || profile === DEFAULT_PROFILE ? "" : profile);
