import { requireAdmin, requireMember, requireUser } from "@/lib/auth";
import { handleError, json } from "@/lib/http";
import type { Invitation } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { db, user } = await requireUser();
    const role = await requireMember(db, id, user.id);

    const members = await db.listMembers(id);
    const invitations: Invitation[] = role === "admin" ? await db.listInvitations(id) : [];

    return json({ members, invitations, role });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { db, user } = await requireUser();
    await requireAdmin(db, id, user.id);

    const token = await db.createInvitation(id, user.id);

    const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(request.url).origin;
    const url = `${origin}/invite/${token}`;

    return json({ token, url }, 201);
  } catch (e) {
    return handleError(e);
  }
}
