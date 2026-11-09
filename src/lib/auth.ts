import { BACKEND } from "@/lib/backend";
import { getStore, type Store } from "@/lib/db";
import { ApiError } from "@/lib/http";
import type { AgentRow, Role } from "@/lib/types";

// `db` is the privileged data layer (src/lib/db — the Supabase service-role client, or Neon's
// DATABASE_URL). All table access in this app goes through it, which makes the helpers below the
// authorization boundary. The user's IDENTITY still comes only from their verified session cookie
// (getSession), never from `db`; `db` is used purely to run the query once the session-derived user
// id has been checked against the memberships table.
export type DB = Store;

export interface SessionUser {
  id: string;
  email: string | null;
}

export async function getSession(): Promise<{ user: SessionUser | null }> {
  if (BACKEND === "neon") {
    // Touch cookies first so a static prerender bails out here (marking the route dynamic) instead
    // of inside the SDK, which logs Next's bail-out signal as a cookie error before rethrowing it.
    const { cookies } = await import("next/headers");
    await cookies();
    const { neonAuth } = await import("@/lib/neon/auth");
    const { data } = await neonAuth().getSession();
    const user = data?.user;
    return { user: user ? { id: String(user.id), email: user.email ?? null } : null };
  }
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { user: user ? { id: user.id, email: user.email ?? null } : null };
}

export async function requireUser() {
  const { user } = await getSession();
  if (!user) throw new ApiError(401, "unauthorized", "Sign in required");
  return { db: getStore(), user };
}

export async function getRole(db: DB, workspaceId: string, userId: string): Promise<Role | null> {
  return db.getRole(workspaceId, userId);
}

// 404 (not 403) so we don't leak whether the workspace exists.
export async function requireMember(db: DB, workspaceId: string, userId: string): Promise<Role> {
  const role = await getRole(db, workspaceId, userId);
  if (!role) throw new ApiError(404, "not_found", "Workspace not found");
  return role;
}

export async function requireAdmin(db: DB, workspaceId: string, userId: string): Promise<void> {
  const role = await getRole(db, workspaceId, userId);
  if (role !== "admin") throw new ApiError(403, "forbidden", "Admin role required");
}

export async function getAgentRow(db: DB, agent37Id: string): Promise<AgentRow> {
  const row = await db.getAgent(agent37Id);
  if (!row) throw new ApiError(404, "not_found", "Agent not found");
  return row;
}

// The auth + ownership preamble every per-agent BFF route repeats: require a signed-in user,
// resolve the agent's mirror row, then gate on the workspace role — "member" for reads, "admin"
// for mutations. Returns the privileged client, user, and row so the handler can get on with its
// work (and run its DB writes through `db`).
export async function requireAgentAccess(agent37Id: string, access: "member" | "admin" = "member") {
  const { db, user } = await requireUser();
  const row = await getAgentRow(db, agent37Id);
  if (access === "admin") await requireAdmin(db, row.workspace_id, user.id);
  else await requireMember(db, row.workspace_id, user.id);
  return { db, user, row };
}
