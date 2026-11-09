import { agent37, Agent37Error } from "@/lib/agent37";
import { requireAgentAccess } from "@/lib/auth";
import { ApiError, handleError, json, readJson } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { db } = await requireAgentAccess(id, "admin");

    const { name } = await readJson<{ name?: string }>(request);
    const trimmed = (name || "").trim();
    if (!trimmed) throw new ApiError(400, "invalid_request", "name is required");

    await db.updateAgent(id, { name: trimmed });

    return json({ id, name: trimmed });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { db } = await requireAgentAccess(id, "admin");

    try {
      await agent37.deleteAgent(id);
    } catch (e) {
      // Instance already gone upstream — still remove our mirror row.
      if (!(e instanceof Agent37Error && e.status === 404)) throw e;
    }
    await db.deleteAgent(id);

    return json({ id, deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
