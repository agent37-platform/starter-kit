import type { AgentRow, Invitation, Role, Workspace, WorkspaceMember, WorkspaceWithRole } from "@/lib/types";

export interface InvitationInfo {
  workspace_id: string;
  workspace_name: string;
  role: Role;
  expired: boolean;
}

export type NewAgentRow = Omit<AgentRow, "created_at">;
export type AgentPatch = Partial<Pick<AgentRow, "name" | "status" | "cpu" | "memory" | "disk">>;

// Every table read and write the app makes, behind one interface so the BFF routes don't care which
// backend holds the data. Implementations: ./supabase.ts (service-role client) and ./neon.ts
// (DATABASE_URL). Both are privileged — NONE of these methods check who is calling. The callers in
// src/app/api/** must gate each call with the helpers in src/lib/auth.ts first.
//
// Failures throw ApiError (500 "db_error" unless noted), so routes can let them propagate.
export interface Store {
  getRole(workspaceId: string, userId: string): Promise<Role | null>;

  listWorkspaces(userId: string): Promise<WorkspaceWithRole[]>;
  // Creates the workspace AND the owner's admin membership.
  createWorkspace(name: string, ownerId: string): Promise<Workspace>;
  renameWorkspace(id: string, name: string): Promise<Workspace>;
  getWorkspaceOwner(id: string): Promise<string | null>;
  deleteWorkspace(id: string): Promise<void>;

  listMembers(workspaceId: string): Promise<WorkspaceMember[]>;
  removeMember(workspaceId: string, userId: string): Promise<void>;

  listInvitations(workspaceId: string): Promise<Invitation[]>;
  createInvitation(workspaceId: string, createdBy: string): Promise<string>;
  deleteInvitation(workspaceId: string, token: string): Promise<void>;
  // Gated by the token (a secret), not by membership. null when the token is unknown or malformed.
  getInvitation(token: string): Promise<InvitationInfo | null>;
  // Returns the workspace id. Throws ApiError 400 when the token is unknown or expired.
  acceptInvitation(token: string, userId: string): Promise<string>;

  getAgent(agent37Id: string): Promise<AgentRow | null>;
  listAgents(workspaceId: string): Promise<AgentRow[]>;
  insertAgent(row: NewAgentRow): Promise<void>;
  // Only the keys present in `patch` change.
  updateAgent(agent37Id: string, patch: AgentPatch): Promise<void>;
  deleteAgent(agent37Id: string): Promise<void>;
}
