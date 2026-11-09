import { requireAdmin, requireUser } from "@/lib/auth";
import { ApiError, handleError, json } from "@/lib/http";

type Ctx = { params: Promise<{ id: string; userId: string }> };

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { id, userId } = await params;
    const { db, user } = await requireUser();

    if (userId !== user.id) {
      await requireAdmin(db, id, user.id);
    }
    if ((await db.getWorkspaceOwner(id)) === userId) {
      throw new ApiError(400, "invalid_request", "The workspace owner cannot be removed");
    }

    await db.removeMember(id, userId);
    return json({ user_id: userId, removed: true });
  } catch (e) {
    return handleError(e);
  }
}
