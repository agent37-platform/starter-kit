import { requireMember, requireUser } from "@/lib/auth";
import { workspaceMembers } from "@/lib/workspace-members";
import { backoffice, BackofficeError } from "@/lib/backoffice";
import { ApiError, handleError, json, readJson } from "@/lib/http";
import { authViaBackoffice } from "@/lib/runtime-config";
import { readSession } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return json(await workspaceMembers(id));
  } catch (e) {
    return handleError(e);
  }
}

// An admin invites someone to the enterprise chat; the back office creates the account and checks the
// subscription's user quota and the chat's seats. Members with Experts stay Yelema's to add.
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { db, user } = await requireUser();
    const role = await requireMember(db, id, user.id);
    if (!authViaBackoffice() || role !== "admin") throw new ApiError(403, "forbidden", "Réservé aux administrateurs de l’espace.");
    const body = await readJson<{ email?: unknown; firstName?: unknown; lastName?: unknown }>(request);
    const field = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const session = await readSession();
    if (!session) throw new ApiError(401, "unauthorized", "Session expirée.");
    try {
      return json(await backoffice.inviteMember(session.accessToken, { email: field(body.email, 254), firstName: field(body.firstName, 60), lastName: field(body.lastName, 60) }));
    } catch (e) {
      if (e instanceof BackofficeError) throw new ApiError(e.status, e.code, e.message);
      throw e;
    }
  } catch (e) {
    return handleError(e);
  }
}
