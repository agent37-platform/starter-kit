import { requireUser } from "@/lib/auth";
import { handleError, json, readJson, ApiError } from "@/lib/http";
import type { Role } from "@/lib/types";

export async function GET() {
  try {
    const { db, user } = await requireUser();
    return json({ workspaces: await db.listWorkspaces(user.id) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser();
    const { name } = await readJson<{ name?: string }>(request);
    const trimmed = (name || "").trim();
    if (!trimmed) throw new ApiError(400, "invalid_request", "Workspace name is required");

    const workspace = await db.createWorkspace(trimmed, user.id);
    return json({ workspace: { ...workspace, role: "admin" as Role } }, 201);
  } catch (e) {
    return handleError(e);
  }
}
