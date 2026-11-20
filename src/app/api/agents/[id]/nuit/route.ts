import { requireAgentAccess } from "@/lib/auth";
import { hermesCron } from "@/lib/hermes-cron";
import { routinesOf } from "@/lib/routine-store";
import { handleError, json } from "@/lib/http";
import { nightOf, type NightItem } from "@/lib/nuit";
import { routineExpert } from "../routines/_body";

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const MAX_PROFILES = 20;

// « Cette nuit » (?profiles=a,b): for each expert of the instance, its Kanban tasks (image I79) and its routines since
// yesterday 18:00. An expert that cannot be read is left out; `tasks: false` when the image cannot list tasks yet.
export async function GET(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { row } = await requireAgentAccess(id);
    const profiles = [...new Set((new URL(request.url).searchParams.get("profiles") ?? "").split(",").map((p) => p.trim()).filter(Boolean))].slice(0, MAX_PROFILES);
    const store = await routinesOf(id);
    const now = Date.now();
    let tasks = true;
    const experts: Record<string, NightItem[]> = {};
    await Promise.all(
      profiles.map(async (raw) => {
        try {
          const expert = await routineExpert(row, raw, { skills: false });
          const [taches, routines] = await Promise.all([
            store === hermesCron ? hermesCron.taches(id, expert.profile).catch(() => []) : Promise.resolve(null),
            store.list(id, expert.profile, expert.name).catch(() => []),
          ]);
          if (taches === null) tasks = false;
          experts[expert.profile] = nightOf(taches ?? [], routines, now);
        } catch {
          // An expert that cannot be read has no line: the review never blocks on one.
        }
      })
    );
    return json({ experts, tasks });
  } catch (e) {
    return handleError(e);
  }
}
