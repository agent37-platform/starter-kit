import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { ApiError } from "@/lib/http";
import type { AgentRow, Invitation, Role, Workspace, WorkspaceMember, WorkspaceWithRole } from "@/lib/types";
import type { InvitationInfo, NewAgentRow, Store } from "./types";

// The Neon Store: plain SQL over DATABASE_URL with Neon's HTTP driver (one round trip per query, no
// pool to manage on serverless). DATABASE_URL is server-only and the browser has no other path to
// Postgres, so — as on Supabase — the checks in src/lib/auth.ts are the authorization boundary.
// Schema: neon/migrations/0001_init.sql. Users live in neon_auth."user", managed by Neon Auth.

type Row = Record<string, unknown>;

// The driver returns timestamptz as Date; the app's types (and the Supabase path) use ISO strings.
function iso<T>(row: Row): T {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out as T;
}

// Workspace ids, user ids and invitation tokens are uuids; a malformed one (e.g. from a URL path) is
// a "not found", not a Postgres cast error.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string) => UUID_RE.test(v);

async function run<T>(query: Promise<T>): Promise<T> {
  try {
    return await query;
  } catch (e) {
    throw new ApiError(500, "db_error", e instanceof Error ? e.message : String(e));
  }
}

let cached: NeonQueryFunction<false, false> | null = null;

function client(): NeonQueryFunction<false, false> {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("The Neon backend needs DATABASE_URL — run `npm run setup:neon`.");
  cached = neon(url);
  return cached;
}

export function createNeonStore(): Store {
  const sql = client();

  return {
    async getRole(workspaceId, userId) {
      if (!isUuid(workspaceId) || !isUuid(userId)) return null;
      const rows = await run(sql`
        select role from public.memberships where workspace_id = ${workspaceId} and user_id = ${userId}`);
      return (rows[0]?.role as Role | undefined) ?? null;
    },

    async listWorkspaces(userId) {
      const rows = await run(sql`
        select w.*, m.role
        from public.memberships m
        join public.workspaces w on w.id = m.workspace_id
        where m.user_id = ${userId}
        order by w.created_at`);
      return rows.map((r) => iso<WorkspaceWithRole>(r));
    },

    // One statement: the workspace row and the owner's admin membership commit together.
    async createWorkspace(name, ownerId) {
      const rows = await run(sql`
        with ws as (
          insert into public.workspaces (name, owner_id) values (${name}, ${ownerId}) returning *
        ), m as (
          insert into public.memberships (workspace_id, user_id, role)
          select id, owner_id, 'admin' from ws
          on conflict do nothing
        )
        select * from ws`);
      if (!rows[0]) throw new ApiError(500, "db_error", "no row returned");
      return iso<Workspace>(rows[0]);
    },

    async renameWorkspace(id, name) {
      const rows = await run(sql`update public.workspaces set name = ${name} where id = ${id} returning *`);
      if (!rows[0]) throw new ApiError(404, "not_found", "Workspace not found");
      return iso<Workspace>(rows[0]);
    },

    async getWorkspaceOwner(id) {
      if (!isUuid(id)) return null;
      const rows = await run(sql`select owner_id from public.workspaces where id = ${id}`);
      return (rows[0]?.owner_id as string | undefined) ?? null;
    },

    async deleteWorkspace(id) {
      await run(sql`delete from public.workspaces where id = ${id}`);
    },

    // Emails come from Neon Auth's own user table, which lives in this same database.
    async listMembers(workspaceId) {
      const rows = await run(sql`
        select m.user_id, u.email::text as email, m.role, m.created_at
        from public.memberships m
        join neon_auth."user" u on u.id = m.user_id
        where m.workspace_id = ${workspaceId}
        order by m.created_at`);
      return rows.map((r) => iso<WorkspaceMember>(r));
    },

    async removeMember(workspaceId, userId) {
      if (!isUuid(userId)) return;
      await run(sql`delete from public.memberships where workspace_id = ${workspaceId} and user_id = ${userId}`);
    },

    async listInvitations(workspaceId) {
      const rows = await run(sql`
        select * from public.invitations where workspace_id = ${workspaceId} order by created_at desc`);
      return rows.map((r) => iso<Invitation>(r));
    },

    async createInvitation(workspaceId, createdBy) {
      const rows = await run(sql`
        insert into public.invitations (workspace_id, role, created_by)
        values (${workspaceId}, 'admin', ${createdBy})
        returning token`);
      return rows[0].token as string;
    },

    async deleteInvitation(workspaceId, token) {
      if (!isUuid(token)) return;
      await run(sql`delete from public.invitations where token = ${token} and workspace_id = ${workspaceId}`);
    },

    async getInvitation(token) {
      if (!isUuid(token)) return null;
      try {
        const rows = await sql`
          select i.workspace_id, w.name as workspace_name, i.role, (i.expires_at < now()) as expired
          from public.invitations i
          join public.workspaces w on w.id = i.workspace_id
          where i.token = ${token}`;
        return (rows[0] as InvitationInfo | undefined) ?? null;
      } catch {
        return null;
      }
    },

    async acceptInvitation(token, userId) {
      if (!isUuid(token)) throw new ApiError(400, "invalid_request", "invitation not found");
      try {
        const rows = await sql`select public.accept_invitation(${token}::uuid, ${userId}::uuid) as workspace_id`;
        return rows[0].workspace_id as string;
      } catch (e) {
        throw new ApiError(400, "invalid_request", e instanceof Error ? e.message : String(e));
      }
    },

    async getAgent(agent37Id) {
      const rows = await run(sql`select * from public.agents where agent37_id = ${agent37Id}`);
      return rows[0] ? iso<AgentRow>(rows[0]) : null;
    },

    async listAgents(workspaceId) {
      const rows = await run(sql`
        select * from public.agents where workspace_id = ${workspaceId} order by created_at desc`);
      return rows.map((r) => iso<AgentRow>(r));
    },

    async insertAgent(row: NewAgentRow) {
      await run(sql`
        insert into public.agents
          (agent37_id, workspace_id, name, status, template, cpu, memory, disk, created_by)
        values
          (${row.agent37_id}, ${row.workspace_id}, ${row.name}, ${row.status}, ${row.template},
           ${row.cpu}, ${row.memory}, ${row.disk}, ${row.created_by})`);
    },

    // coalesce keeps a column unchanged when the patch omits it.
    async updateAgent(agent37Id, patch) {
      await run(sql`
        update public.agents
        set name   = coalesce(${patch.name ?? null}::text, name),
            status = coalesce(${patch.status ?? null}::text, status),
            cpu    = coalesce(${patch.cpu ?? null}::integer, cpu),
            memory = coalesce(${patch.memory ?? null}::integer, memory),
            disk   = coalesce(${patch.disk ?? null}::integer, disk)
        where agent37_id = ${agent37Id}`);
    },

    async deleteAgent(agent37Id) {
      await run(sql`delete from public.agents where agent37_id = ${agent37Id}`);
    },
  };
}
