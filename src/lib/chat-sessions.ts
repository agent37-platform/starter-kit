import "server-only";
import { agent37 } from "@/lib/agent37";
import { requireAgentAccess } from "@/lib/auth";
import { profileQuery, resolveProfile } from "@/lib/profiles";
import { isMemoryRun, routineOfSession } from "@/lib/routines";
import { sessionTitle } from "@/lib/session-title";
import { isSystemSession } from "@/lib/system-sessions";
import { isVoiceSession } from "@/lib/voice-sessions";
import { undeliveredRunIds } from "@/lib/silent-runs";
import type { ChatSession } from "@/components/chat/types";

// The thread rail of one expert (`profile`), or of the instance's default home without it, from
// GET /v1/sessions (every channel alike; no local index). Each label is `title || preview`, most
// recently active first, so the client needs no per-session fetch. Checks the caller's access.
export async function chatSessions(agentId: string, profileParam: string | null): Promise<ChatSession[]> {
  const { row } = await requireAgentAccess(agentId);
  const query = profileQuery(await resolveProfile(row, profileParam));
  const { data } = await agent37.listSessions(agentId, query);
  // A routine run is a conversation only once it has delivered: running, nothing to report, failed
  // or not read yet, the bell has it.
  const hidden = await undeliveredRunIds(agentId, query, data);
  return data
    .filter((s) => !isVoiceSession(s.preview) && !hidden.has(s.id) && !isMemoryRun(s) && !isSystemSession(s))
    .map((s) => ({
      session_id: s.id,
      title: sessionTitle(s.title, s.preview),
      last_active: s.last_active ?? s.started_at ?? 0,
      routine: routineOfSession(s),
    }))
    .sort((a, b) => b.last_active - a.last_active);
}
