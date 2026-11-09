import { agent37 } from "@/lib/agent37";
import { requireAgentAccess } from "@/lib/auth";
import { ApiError, handleError, json } from "@/lib/http";

type Ctx = { params: Promise<{ id: string; action: string }> };

const ACTIONS = {
  start: agent37.start,
  stop: agent37.stop,
  restart: agent37.restart,
  update: agent37.update,
} as const;

export async function POST(_request: Request, { params }: Ctx) {
  try {
    const { id, action } = await params;
    const fn = ACTIONS[action as keyof typeof ACTIONS];
    if (!fn) throw new ApiError(404, "not_found", `Unknown action: ${action}`);

    const { db } = await requireAgentAccess(id, "admin");

    const result = await fn(id);
    if (result.status) {
      await db.updateAgent(id, { status: result.status });
    }

    return json(result);
  } catch (e) {
    return handleError(e);
  }
}
