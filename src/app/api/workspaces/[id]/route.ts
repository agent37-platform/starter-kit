import { requireAdmin, requireUser } from "@/lib/auth";
import { agent37 } from "@/lib/agent37";
import { ApiError, handleError, json, readJson } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { db, user } = await requireUser();
    await requireAdmin(db, id, user.id);

    const { name } = await readJson<{ name?: string }>(request);
    const trimmed = (name || "").trim();
    if (!trimmed) throw new ApiError(400, "invalid_request", "Workspace name is required");

    return json({ workspace: await db.renameWorkspace(id, trimmed) });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { db, user } = await requireUser();

    const ownerId = await db.getWorkspaceOwner(id);
    if (!ownerId) throw new ApiError(404, "not_found", "Workspace not found");
    if (ownerId !== user.id) throw new ApiError(403, "forbidden", "Only the owner can delete a workspace");

    // Tear down the workspace's Agent37 agents first so none are orphaned.
    for (const row of await db.listAgents(id)) {
      try {
        await agent37.deleteAgent(row.agent37_id);
      } catch {
        /* best-effort */
      }
    }

    await db.deleteWorkspace(id);
    return json({ id, deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
