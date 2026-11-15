import { apiFetch } from "@/lib/api";
import { oncePer } from "@/lib/once-per";

// One light read wakes a sleeping instance (it sleeps after 30 idle minutes), at most once per 5 minutes
// whatever asks: an expert's chat opened, its composer focused. `force`: ReadAhead's own schedule.
const due = oncePer(5 * 60_000);

export function wakeInstance(agentId: string, force = false): void {
  if (!due(agentId) && !force) return;
  apiFetch(`/api/agents/${agentId}/chat/sessions`).catch(() => {});
}
