import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { WorkspaceProvider } from "@/components/WorkspaceProvider";
import type { Role } from "@/lib/types";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = await getSession();
  if (!user) redirect("/login");

  // Table access goes through the privileged data layer; the user came from the verified session above.
  // First sign-in: create the user's own workspace (and their admin membership) from the rows we just
  // wrote — no read-back.
  const db = getStore();
  let workspaces = await db.listWorkspaces(user.id);
  if (workspaces.length === 0) {
    workspaces = [{ ...(await db.createWorkspace("My Workspace", user.id)), role: "admin" as Role }];
  }

  // The chrome (DashboardShell sidebar) lives in the (fleet) route group's layout, NOT here:
  // the per-agent workspace route renders its own full-height shell and must not be wrapped in it.
  // This layer only establishes auth + the WorkspaceProvider that both branches share.
  return (
    <WorkspaceProvider initialWorkspaces={workspaces} userEmail={user.email ?? ""}>
      {children}
    </WorkspaceProvider>
  );
}
