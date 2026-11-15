import "server-only";
import { cache } from "react";
import { getSession, type DB } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { authViaBackoffice } from "@/lib/runtime-config";
import { pinnedWorkspaceId } from "@/lib/tenant";
import { currentInstance, currentPrincipal, workspaceOfMe } from "@/lib/session";
import { catalogueWithInstalled, profilesMirrored, userExperts, visibleAgents } from "@/lib/installed-experts";
import { backofficeAgents } from "@/lib/my-agents";
import type { InitialExperts } from "@/components/experts/useExperts";
import type { CatalogueResponse, MergedAgent, Role, Workspace, WorkspaceWithRole } from "@/lib/types";

// Read the user's workspaces with two plain table queries joined in JS, NOT a PostgREST relationship
// embed (`memberships?select=role,workspaces(*)`). The embed needs the memberships→workspaces
// foreign key to be live in PostgREST's schema cache; right after a fresh `npm run setup` migration
// that cache can briefly lag, and the embed then comes back empty even though the rows exist. Plain
// selects don't depend on the relationship, and we surface real query errors instead of mistaking
// them for an empty result.
async function loadWorkspaces(db: DB, userId: string): Promise<WorkspaceWithRole[]> {
  // A deployment only ever shows its own client's workspace (shared database).
  let query = db.from("memberships").select("workspace_id, role").eq("user_id", userId);
  const pinned = await pinnedWorkspaceId();
  if (pinned) query = query.eq("workspace_id", pinned);
  const { data: memberships, error: memErr } = await query;
  if (memErr) throw new Error(`Couldn't load your workspaces: ${memErr.message}`);
  if (!memberships?.length) return [];

  const roleByWorkspace = new Map<string, Role>(
    memberships.map((m) => [m.workspace_id as string, m.role as Role])
  );
  const { data: workspaces, error: wsErr } = await db
    .from("workspaces")
    .select("*")
    .in("id", [...roleByWorkspace.keys()]);
  if (wsErr) throw new Error(`Couldn't load your workspaces: ${wsErr.message}`);

  return (workspaces ?? [])
    .map((ws) => ({ ...(ws as Workspace), role: roleByWorkspace.get((ws as Workspace).id)! }))
    .filter((w): w is WorkspaceWithRole => Boolean(w.role))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

// What the shell shows from the start, read with the page so the menu, the home and the gallery
// arrive filled instead of asking for them once the page is up: the experts, the catalogue and the
// instance. Only when it costs no call into an instance (the profiles are mirrored); otherwise, or
// on any failure, the browser asks as before and shows the error itself.
const loadInitialShell = cache(async (workspaceId: string, userId: string, email: string | null): Promise<InitialShell> => {
  const none = { experts: null, catalogue: null, agents: null };
  try {
    const agents = await visibleAgents(createAdminClient(), workspaceId, userId);
    if (!profilesMirrored(agents)) return none;
    const [experts, catalogue, rows] = await Promise.all([
      userExperts(agents),
      catalogueWithInstalled(agents).catch(() => null),
      authViaBackoffice() ? backofficeAgents(email).catch(() => null) : null,
    ]);
    return { experts: { workspaceId, ...experts }, catalogue, agents: rows };
  } catch {
    return none;
  }
});


export type InitialShell = { experts: InitialExperts | null; catalogue: CatalogueResponse | null; agents: MergedAgent[] | null };

/**
 * Who is signed in, their workspaces and the shell's first data: read once per request, shared by the
 * layout and the pages that load their first screen on the server.
 */
export const appContext = cache(async () => {
  // Asked now, alongside "who is this", so the experts below do not wait for it in turn.
  if (authViaBackoffice()) void currentInstance().catch(() => null);
  const { user } = await getSession();
  if (!user) return { user: null, me: null, workspaces: [], initial: null } as const;
  // Signed in through the back office: it already said which workspace this is and the user's role.
  // Otherwise table access goes through the privileged client; the user came from the verified session.
  const me = authViaBackoffice() ? await currentPrincipal() : null;
  const workspaces: WorkspaceWithRole[] = me ? [workspaceOfMe(me)] : authViaBackoffice() ? [] : await loadWorkspaces(createAdminClient(), user.id);
  const initial = workspaces.length ? await loadInitialShell(workspaces[0].id, user.id, user.email) : null;
  return { user, me, workspaces, initial };
});
