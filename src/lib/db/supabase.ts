import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/lib/http";
import type { AgentRow, Invitation, Role, Workspace, WorkspaceMember, WorkspaceWithRole } from "@/lib/types";
import type { InvitationInfo, NewAgentRow, Store } from "./types";

// Same rule as the Neon store: a malformed uuid (from a URL path) is "not found", not a Postgres error.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(error: { message: string } | null | undefined): void {
  if (error) throw new ApiError(500, "db_error", error.message);
}

// The Supabase Store: every query runs through the service-role client (RLS bypassed), so the
// authorization checks in src/lib/auth.ts are the security boundary. See src/lib/supabase/admin.ts.
export function createSupabaseStore(): Store {
  const db = createAdminClient();

  return {
    async getRole(workspaceId, userId) {
      const { data } = await db
        .from("memberships")
        .select("role")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .maybeSingle();
      return (data?.role as Role) ?? null;
    },

    // Two plain table queries joined in JS, NOT a PostgREST relationship embed
    // (`memberships?select=role,workspaces(*)`). The embed needs the memberships→workspaces foreign
    // key to be live in PostgREST's schema cache; right after a fresh `npm run setup` migration that
    // cache can briefly lag, and the embed then comes back empty even though the rows exist.
    async listWorkspaces(userId) {
      const { data: memberships, error: memErr } = await db
        .from("memberships")
        .select("workspace_id, role")
        .eq("user_id", userId);
      fail(memErr);
      if (!memberships?.length) return [];

      const roleByWorkspace = new Map<string, Role>(
        memberships.map((m) => [m.workspace_id as string, m.role as Role])
      );
      const { data: workspaces, error: wsErr } = await db
        .from("workspaces")
        .select("*")
        .in("id", [...roleByWorkspace.keys()]);
      fail(wsErr);

      return (workspaces ?? [])
        .map((ws) => ({ ...(ws as Workspace), role: roleByWorkspace.get((ws as Workspace).id)! }))
        .filter((w): w is WorkspaceWithRole => Boolean(w.role))
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    },

    // The on_workspace_created trigger normally adds the admin membership in the same transaction;
    // the upsert makes that not matter (idempotent on-conflict no-op).
    async createWorkspace(name, ownerId) {
      const { data: ws, error } = await db
        .from("workspaces")
        .insert({ name, owner_id: ownerId })
        .select("*")
        .single();
      if (error || !ws) throw new ApiError(500, "db_error", error?.message ?? "no row returned");
      const { error: memErr } = await db
        .from("memberships")
        .upsert({ workspace_id: ws.id, user_id: ownerId, role: "admin" }, { onConflict: "workspace_id,user_id" });
      fail(memErr);
      return ws as Workspace;
    },

    async renameWorkspace(id, name) {
      const { data, error } = await db.from("workspaces").update({ name }).eq("id", id).select("*").single();
      fail(error);
      return data as Workspace;
    },

    async getWorkspaceOwner(id) {
      const { data } = await db.from("workspaces").select("owner_id").eq("id", id).maybeSingle();
      return (data?.owner_id as string | undefined) ?? null;
    },

    async deleteWorkspace(id) {
      const { error } = await db.from("workspaces").delete().eq("id", id);
      fail(error);
    },

    async listMembers(workspaceId) {
      const { data, error } = await db.rpc("get_workspace_members", { p_workspace: workspaceId });
      fail(error);
      return (data as WorkspaceMember[]) ?? [];
    },

    async removeMember(workspaceId, userId) {
      const { error } = await db.from("memberships").delete().eq("workspace_id", workspaceId).eq("user_id", userId);
      fail(error);
    },

    async listInvitations(workspaceId) {
      const { data } = await db
        .from("invitations")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });
      return (data as Invitation[]) ?? [];
    },

    async createInvitation(workspaceId, createdBy) {
      const { data, error } = await db
        .from("invitations")
        .insert({ workspace_id: workspaceId, role: "admin", created_by: createdBy })
        .select("token")
        .single();
      fail(error);
      return data!.token as string;
    },

    async deleteInvitation(workspaceId, token) {
      const { error } = await db.from("invitations").delete().eq("token", token).eq("workspace_id", workspaceId);
      fail(error);
    },

    async getInvitation(token) {
      const { data, error } = await db.rpc("get_invitation", { p_token: token });
      const inv = Array.isArray(data) ? (data[0] as InvitationInfo | undefined) : undefined;
      return error || !inv ? null : inv;
    },

    // Pass the verified user id explicitly: under the service-role client auth.uid() is NULL, so the
    // function can't read it from the JWT.
    async acceptInvitation(token, userId) {
      if (!UUID_RE.test(token)) throw new ApiError(400, "invalid_request", "invitation not found");
      const { data, error } = await db.rpc("accept_invitation", { p_token: token, p_user: userId });
      if (error) throw new ApiError(400, "invalid_request", error.message);
      return data as string;
    },

    async getAgent(agent37Id) {
      const { data } = await db.from("agents").select("*").eq("agent37_id", agent37Id).maybeSingle();
      return (data as AgentRow | null) ?? null;
    },

    async listAgents(workspaceId) {
      const { data, error } = await db
        .from("agents")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });
      fail(error);
      return (data as AgentRow[]) ?? [];
    },

    async insertAgent(row: NewAgentRow) {
      const { error } = await db.from("agents").insert(row);
      fail(error);
    },

    async updateAgent(agent37Id, patch) {
      const { error } = await db.from("agents").update(patch).eq("agent37_id", agent37Id);
      fail(error);
    },

    async deleteAgent(agent37Id) {
      const { error } = await db.from("agents").delete().eq("agent37_id", agent37Id);
      fail(error);
    },
  };
}
