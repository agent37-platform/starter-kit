import { requireUser } from "@/lib/auth";
import { handleError, json } from "@/lib/http";

type Ctx = { params: Promise<{ token: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  try {
    const { token } = await params;
    const { db, user } = await requireUser();

    // The verified session user id is passed explicitly; the store never infers who is calling.
    return json({ workspace_id: await db.acceptInvitation(token, user.id) });
  } catch (e) {
    return handleError(e);
  }
}
