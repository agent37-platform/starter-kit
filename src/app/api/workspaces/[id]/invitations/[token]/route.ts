import { requireAdmin, requireUser } from "@/lib/auth";
import { handleError, json } from "@/lib/http";

type Ctx = { params: Promise<{ id: string; token: string }> };

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { id, token } = await params;
    const { db, user } = await requireUser();
    await requireAdmin(db, id, user.id);

    await db.deleteInvitation(id, token);
    return json({ token, deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
