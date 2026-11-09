import { agent37 } from "@/lib/agent37";
import { requireAgentAccess } from "@/lib/auth";
import { ApiError, handleError, json, readJson } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { db } = await requireAgentAccess(id, "admin");

    const body = await readJson<{ cpu?: number; memory?: number; disk?: number }>(request);
    if (!body.cpu && !body.memory && !body.disk) {
      throw new ApiError(400, "invalid_request", "Provide at least one of cpu, memory, disk");
    }

    const result = await agent37.resize(id, body);
    await db.updateAgent(id, {
      cpu: result.resources.cpu,
      memory: result.resources.memory,
      disk: result.resources.disk,
      status: result.status,
    });

    return json(result);
  } catch (e) {
    return handleError(e);
  }
}
