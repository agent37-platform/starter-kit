"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, LogOut, Plus } from "lucide-react";
import { toast } from "sonner";
import { signOut as authSignOut } from "@/lib/auth-client";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch } from "@/lib/api";
import type { WorkspaceWithRole } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// The account + workspace control, pinned to the BOTTOM of every sidebar (fleet and per-agent) and
// merged with sign-out — the conventional SaaS placement, near the user's identity. This pairs with
// the per-agent ActiveAgentSwitcher at the TOP: workspace is the outer context (bottom), agent is the
// inner one (top). Switching workspace routes to the fleet (/dashboard) of the newly selected
// workspace — from the per-agent view that also escapes the agent's URL, whose effect would otherwise
// immediately re-pin the old workspace.
export function AccountMenu() {
  const router = useRouter();
  const { workspaces, current, setCurrentId, refresh, userEmail } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const initial = (userEmail.trim()[0] ?? "?").toUpperCase();

  function switchWorkspace(id: string) {
    if (id === current?.id) return;
    setCurrentId(id);
    router.push("/dashboard");
  }

  async function signOut() {
    await authSignOut();
    window.location.href = "/login";
  }

  async function createWorkspace() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { workspace } = await apiFetch<{ workspace: WorkspaceWithRole }>("/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      await refresh();
      setCurrentId(workspace.id);
      setName("");
      setCreating(false);
      router.push("/dashboard");
      toast.success("Workspace created");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-auto w-full justify-between px-2 py-2 font-normal">
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-medium text-secondary-foreground">
                {initial}
              </span>
              <span className="flex min-w-0 flex-col text-left">
                <span className="truncate text-sm">{userEmail}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {current?.name ?? "Select workspace"}
                </span>
              </span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="start" side="top">
          <DropdownMenuLabel className="flex items-center gap-2 font-normal">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-medium text-secondary-foreground">
              {initial}
            </span>
            <span className="min-w-0 truncate">{userEmail}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
            Workspaces
          </DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem key={w.id} onClick={() => switchWorkspace(w.id)}>
              <span className="flex-1 truncate">{w.name}</span>
              {w.id === current?.id && <Check className="h-4 w-4" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New workspace
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive">
            <LogOut className="h-4 w-4" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>Workspaces keep agents and members separate.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ws-name">Name</Label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Production"
              onKeyDown={(e) => e.key === "Enter" && createWorkspace()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={createWorkspace} disabled={busy || !name.trim()}>
              {busy ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
