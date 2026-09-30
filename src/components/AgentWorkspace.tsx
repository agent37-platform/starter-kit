"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Blocks, FolderOpen, MessageSquare, MessagesSquare, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { isTransitional } from "@/lib/format";
import { agentTabPath, parseAgentTab, type AgentTab } from "@/lib/dashboard-tabs";
import { branding } from "@/config/branding";
import type { MergedAgent, Role } from "@/lib/types";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { ActiveAgentSwitcher } from "@/components/ActiveAgentSwitcher";
import { AccountMenu } from "@/components/AccountMenu";
import { AgentSettingsTab } from "@/components/AgentSettingsTab";
import { IntegrationsTab } from "@/components/IntegrationsTab";
import { ChannelsTab } from "@/components/channels/ChannelsTab";
import { ChatProvider } from "@/components/chat/ChatProvider";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { ChatView } from "@/components/chat/ChatView";
import { FilesTab } from "@/components/files/FilesTab";
import { cn } from "@/lib/utils";

const TABS: { id: AgentTab; label: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "messaging", label: "Messaging", icon: MessagesSquare },
  { id: "integrations", label: "Integrations", icon: Blocks },
  { id: "settings", label: "Settings", icon: Settings2 },
];

// The per-agent tabbed SPA, laid out as a SINGLE left rail + the active tab's pane. The active agent
// is bound to the URL (agentId); the open tab rides the URL as a path segment. Tabs switch via
// history.pushState (no full navigation) so Chat's in-flight stream and Files' current directory
// survive moving between tabs — those two mount lazily then stay MOUNTED-BUT-HIDDEN; Integrations
// and Settings mount lazily in the scroll area.
//
// ChatProvider wraps the WHOLE workspace (not just the Chat pane) so the "Chats" thread list can live
// in this one sidebar — folded in under the nav on the Chat tab — instead of a second rail. The chat
// thread also stays open (and streaming) while you visit Files/Integrations/Settings because the
// provider and ChatView never unmount.
export function AgentWorkspace({
  agentId,
  workspaceId,
  role,
  initialTab,
}: {
  agentId: string;
  workspaceId: string;
  role: Role;
  initialTab: AgentTab;
}) {
  const pathname = usePathname();
  const { setCurrentId } = useWorkspace();

  // Deep-linking to an agent scopes the WorkspaceProvider to its workspace, so the fleet/switcher
  // and any workspace-derived UI stay in sync after a refresh or shared link.
  useEffect(() => {
    setCurrentId(workspaceId);
  }, [workspaceId, setCurrentId]);

  // Live data for every agent in the workspace: the switcher lists them, and `active` carries this
  // agent's live ports / status / update flag. Poll while any agent is mid-transition (AgentsView's
  // approach), so a starting agent's ports light up without a manual refresh.
  const [agents, setAgents] = useState<MergedAgent[]>([]);
  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ agents: MergedAgent[]; role: Role }>(
        `/api/agents?workspace=${workspaceId}`
      );
      setAgents(data.agents);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!agents.some((a) => isTransitional(a.live_status))) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [agents, load]);

  const active = agents.find((a) => a.agent37_id === agentId) ?? null;

  // The open tab follows the URL (history.pushState updates usePathname in the App Router). Fall
  // back to the server-resolved initialTab on the first paint before the path is parsed.
  const segments = pathname.split("/").filter(Boolean); // ["dashboard","agents",id,tab?]
  const currentTab = parseAgentTab(segments.slice(3)) ?? initialTab;
  const isChat = currentTab === "chat";
  const isFiles = currentTab === "files";

  function selectTab(tab: AgentTab) {
    const path = agentTabPath(agentId, tab);
    if (typeof window !== "undefined" && window.location.pathname !== path) {
      window.history.pushState(null, "", path);
    }
  }

  // The open chat thread rides the URL as `?session=` (a query param — the agent route only accepts
  // 0–1 tab segments). Read it on mount (refresh / shared link) and on Back/Forward (popstate). Lifted
  // here (out of the Chat pane) so ChatProvider can wrap both this rail and the pane.
  const [urlSessionId, setUrlSessionId] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setUrlSessionId(new URLSearchParams(window.location.search).get("session"));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const chatPath = agentTabPath(agentId, "chat");
  // Write the open thread into the chat URL without adding a path segment. pushState for an explicit
  // switch (so Back returns to the previous thread); replaceState when promoting a freshly-minted
  // session or re-stamping the URL on tab return (so Back doesn't bounce through transient states).
  const navigateToSession = useCallback(
    (sessionId: string | null, mode: "push" | "replace" = "push") => {
      const url = sessionId ? `${chatPath}?session=${encodeURIComponent(sessionId)}` : chatPath;
      if (typeof window !== "undefined") {
        if (mode === "replace") window.history.replaceState(null, "", url);
        else window.history.pushState(null, "", url);
      }
      setUrlSessionId(sessionId);
    },
    [chatPath]
  );

  // Latch Chat/Files mounted on first open, then keep them mounted (hidden) across tab switches.
  // Latched during render (not in an effect) so the mount lands in the same pass as the switch.
  const [chatOpened, setChatOpened] = useState(isChat);
  if (isChat && !chatOpened) setChatOpened(true);
  const [filesOpened, setFilesOpened] = useState(isFiles);
  if (isFiles && !filesOpened) setFilesOpened(true);

  return (
    <ChatProvider
      agentId={agentId}
      agents={agents}
      urlSessionId={urlSessionId}
      onChatTab={isChat}
      navigateToSession={navigateToSession}
    >
      <div className="flex h-screen">
        <aside className="flex w-64 shrink-0 flex-col border-r bg-card">
          <div className="flex flex-col p-4 pb-3">
            <div className="flex items-center gap-2 px-2 py-1">
              {branding.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={branding.logoUrl} alt="" className="h-6 w-6 rounded" />
              ) : null}
              <span className="truncate font-semibold">{branding.appName}</span>
            </div>

            <Link
              href="/dashboard"
              className="mt-4 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to all agents
            </Link>

            <div className="mt-3">
              <ActiveAgentSwitcher agents={agents} activeAgentId={agentId} currentTab={currentTab} />
            </div>

            <nav className="mt-5 flex flex-col gap-1">
              {TABS.map((t) => {
                const Icon = t.icon;
                const isActive = currentTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => selectTab(t.id)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors",
                      isActive
                        ? "bg-secondary text-secondary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {t.label}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* The "Chats" thread list folds into this one rail on the Chat tab (no second sidebar).
              On other tabs a spacer keeps the account footer pinned to the bottom. */}
          {isChat ? (
            <div className="flex min-h-0 flex-1 flex-col border-t">
              <ChatSidebar />
            </div>
          ) : (
            <div className="flex-1" />
          )}

          {/* Account + workspace switcher (mirrors the fleet sidebar); the agent switcher lives at
              the top. Switching workspace here routes back to that workspace's fleet. */}
          <div className="border-t p-4">
            <AccountMenu />
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-hidden">
          {/* Chat owns its full height and stays MOUNTED (just hidden) across tab switches. */}
          {chatOpened && (
            <div className={cn("h-full", !isChat && "hidden")}>
              <ChatView />
            </div>
          )}
          {/* Files mirrors Chat: full-height, kept MOUNTED so the current directory survives. */}
          {filesOpened && (
            <div className={cn("h-full", !isFiles && "hidden")}>
              <FilesTab agentId={agentId} />
            </div>
          )}
          {/* Integrations + Settings mount lazily in the padded scroll area. */}
          {!isChat && !isFiles && (
            <div className="h-full overflow-y-auto">
              {currentTab === "integrations" ? (
                <div className="mx-auto w-full max-w-5xl p-6 md:px-10 md:py-8">
                  <IntegrationsTab agentId={agentId} role={role} />
                </div>
              ) : currentTab === "messaging" ? (
                <div className="mx-auto w-full max-w-3xl p-6 md:px-10 md:py-8">
                  {active ? (
                    <ChannelsTab agentId={agentId} agent={active} role={role} />
                  ) : (
                    <p className="text-sm text-muted-foreground">Loading...</p>
                  )}
                </div>
              ) : (
                <div className="mx-auto w-full max-w-3xl p-6 md:px-10 md:py-8">
                  {active ? (
                    <AgentSettingsTab agentId={agentId} agent={active} role={role} onChanged={load} />
                  ) : (
                    <p className="text-sm text-muted-foreground">Loading...</p>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </ChatProvider>
  );
}
