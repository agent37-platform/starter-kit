"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Copy, FolderOpen, Mail, MessageSquare, Pencil, Phone, Repeat, X } from "lucide-react";
import { agentTabPath, parseAgentRoute, type AgentTab } from "@/lib/expert-tabs";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { useMyAgents } from "@/components/useMyAgents";
import { ExpertAvatar } from "@/components/experts/ExpertAvatar";
import { ExpertEditModal } from "@/components/experts/ExpertEditModal";
import { usePublicConfig } from "@/components/PublicConfigProvider";
import { ExpertEmails } from "@/components/experts/ExpertEmails";
import { ExpertRoutines } from "@/components/experts/ExpertRoutines";
import { ExpertReadiness } from "@/components/experts/ExpertReadiness";
import { useExpertsContext } from "@/components/experts/ExpertsProvider";
import { useCatalogueExpert } from "@/components/experts/useCatalogue";
import { readExpertScreen } from "@/components/experts/expert-preload";
import { useMailInboxes } from "@/components/experts/useMailInboxes";
import { expertDisplayName } from "@/lib/experts";
import { DRIVE_ROOT } from "@/lib/drive-paths";
import { inboxOf } from "@/lib/mail";
import { ChatProvider } from "@/components/chat/ChatProvider";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { ChatView, hasScreen } from "@/components/chat/ChatView";
import { ComputerMenuItem } from "@/components/experts/ExpertComputer";
import { ExpertMoreMenu } from "@/components/experts/ExpertMoreMenu";
import { DashboardMenuFace } from "@/components/experts/ExpertDashboard";
import { setChatFull, useChatFull, useChatListHidden, useChatSidePanel } from "@/components/chat/chat-layout";
import { FilesTab } from "@/components/files/FilesTab";
import { cn } from "@/lib/utils";
import { CallButton } from "@/components/voice/CallButton";
import { VoiceButton } from "@/components/voice/VoiceButton";
import { ExpertCalls } from "@/components/voice/ExpertCalls";
import { useVoices } from "@/components/voice/useVoices";
import { NotificationBell } from "@/components/app/NotificationBell";

const TABS: { id: AgentTab; label: string; icon: typeof MessageSquare }[] = [
  // Livrables right after Discussion (Leslie, 25/10), then Appels and E-mails.
  { id: "chat", label: "Discussion", icon: MessageSquare },
  { id: "files", label: "Livrables", icon: FolderOpen },
  { id: "calls", label: "Appels", icon: Phone },
  { id: "emails", label: "E-mails", icon: Mail },
  { id: "routines", label: "Routines", icon: Repeat },
];

// The per-expert tabbed SPA, laid out as a SINGLE left rail + the active tab's pane. The instance
// (agentId) and the expert (profileId, a Hermes profile on that instance; null = its default home)
// are bound to the URL; the open tab rides the URL as a path segment. Tabs switch via
// history.pushState (no full navigation) so Chat's in-flight stream and Files' current directory
// survive moving between tabs — those two mount lazily then stay MOUNTED-BUT-HIDDEN; Routines
// and E-mails mount lazily in the scroll area. Connecteurs and Canaux are not here: they are set once for the
// instance, in the Administration. There is no settings tab: the instance (its size, its own
// dashboard and terminal, its budget) is run by Yelema from the back office, not by the member.
//
// ChatProvider wraps the WHOLE workspace (not just the Chat pane) so the "Chats" thread list can live
// in this one sidebar — folded in under the nav on the Chat tab — instead of a second rail. The chat
// thread also stays open (and streaming) while you visit Livrables or Routines because the
// provider and ChatView never unmount.
export function AgentWorkspace({
  agentId,
  profileId,
  workspaceId,
  initialTab,
}: {
  agentId: string;
  profileId: string | null;
  workspaceId: string;
  initialTab: AgentTab;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { setCurrentId, current } = useWorkspace();
  // Only an admin gives or takes an expert's address; the back office checks it again.
  const mailAdmin = current?.role === "admin";

  // Deep-linking to an agent scopes the WorkspaceProvider to its workspace, so the fleet/switcher
  // and any workspace-derived UI stay in sync after a refresh or shared link.
  useEffect(() => {
    setCurrentId(workspaceId);
  }, [workspaceId, setCurrentId]);

  // The user's instances with their live state, which the chat needs (its model list, whether the
  // image streams a screen).
  const { agents } = useMyAgents(workspaceId);

  // The expert this page is about, dressed by the catalogue; its own folder is where Livrables opens.
  const { experts } = useExpertsContext();
  const expert = experts.find((e) => e.agentId === agentId && e.profileId === profileId) ?? null;
  // One call for the page's first reads (models, preparation, catalogue entry), before its parts ask
  // (layout effects run before theirs); what the menu read ahead is not asked again.
  const catalogueKey = expert?.catalogueKey ?? null;
  useLayoutEffect(() => void readExpertScreen(agentId, profileId, catalogueKey), [agentId, profileId, catalogueKey]);
  const driveFolder = expert?.driveFolder ? `${DRIVE_ROOT}/${expert.driveFolder}` : undefined;
  // The expert's own inbox, when the back office gives this member one to read.
  const mail = useMailInboxes(agentId);
  const inbox = expert?.catalogueKey ? inboxOf(mail.inboxes, expert.catalogueKey, agentId) : null;
  const copyAddress = () => {
    if (!inbox) return;
    navigator.clipboard.writeText(inbox.address).then(
      () => toast.success("Adresse e-mail copiée."),
      () => toast.error("L’adresse n’a pas pu être copiée.")
    );
  };
  // Routines belong to an expert's profile: the instance's default home has none here. E-mails show
  // for catalogue experts whenever the workspace mail module is enabled (so the member can opt in).
  // Calls are offered where voice is on, for an expert of the catalogue.
  const voiceOn = useVoices().length > 0;
  const tabs = TABS.filter((t) =>
    t.id === "routines" ? profileId !== null
    : t.id === "tools" ? profileId !== null
    : t.id === "emails" ? mail.enabled && Boolean(expert?.catalogueKey)
    : t.id === "calls" ? voiceOn && Boolean(expert?.catalogueKey)
    : true
  );
  const sheet = useCatalogueExpert(expert?.catalogueKey);
  const expertName = expert?.displayName ?? (profileId ? expertDisplayName(profileId) : "");
  // The face for a call: the photo, or the full-body portrait cropped to it.
  const portrait = expert?.photoUrl ?? (sheet ? sheet.portraitUrl : null);
  // Only an expert of the catalogue can be called: the back office opens the call by its key.
  const callee = expert?.catalogueKey ? { key: expert.catalogueKey, name: expertName, photoUrl: portrait } : null;

  // A message typed on the home page rides the URL as ?q= and is sent once the chat is up. Read once
  // mounted, like ?session= below: on a client navigation from the home page the first render still
  // sees the home page's URL, so reading it during render lost the message.
  const [initialMessage, setInitialMessage] = useState<string | null>(null);
  useEffect(() => setInitialMessage(new URLSearchParams(window.location.search).get("q")), []);

  // The open tab follows the URL (history.pushState updates usePathname in the App Router). Fall
  // back to the server-resolved initialTab on the first paint before the path is parsed.
  const segments = pathname.split("/").filter(Boolean); // ["experts", agentId, profileId?, tab?]
  const currentTab = parseAgentRoute(segments.slice(2))?.tab ?? initialTab;
  // Outils has no tab any more (Leslie, 23/10): an old address to it opens the Discussion.
  useEffect(() => {
    if (currentTab === "tools") window.history.replaceState(null, "", agentTabPath(agentId, "chat", profileId));
  }, [currentTab, agentId, profileId]);
  const isChat = currentTab === "chat" || currentTab === "tools";
  const listFolded = useChatListHidden();
  const sidePanel = useChatSidePanel();
  const listHidden = listFolded || sidePanel;
  const chatFull = useChatFull();
  // Échap, another tab or another page leave the full-screen chat.
  useEffect(() => {
    if (!chatFull) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[role=dialog]")) setChatFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatFull]);
  useEffect(() => {
    if (!isChat) setChatFull(false);
  }, [isChat]);
  useEffect(() => () => setChatFull(false), [pathname]);
  const isFiles = currentTab === "files";

  function selectTab(tab: AgentTab) {
    const path = agentTabPath(agentId, tab, profileId);
    if (typeof window === "undefined") return;
    // The tab already open, deeper in (a call's page): back to its list. The chat keeps its thread.
    const deeper = tab !== "chat" && window.location.search !== "";
    if (window.location.pathname !== path || deeper) {
      window.history.pushState(null, "", path);
    }
  }

  // The open chat thread rides the URL as `?session=` (a query param — the agent route only accepts
  // 0–1 tab segments). Read it on mount (refresh / shared link) and on Back/Forward (popstate). Lifted
  // here (out of the Chat pane) so ChatProvider can wrap both this rail and the pane. Known from the
  // first render, so a thread never paints the new-chat welcome before its messages.
  const searchSession = useSearchParams().get("session");
  const [urlSessionId, setUrlSessionId] = useState<string | null>(searchSession);
  useEffect(() => {
    const read = () => setUrlSessionId(new URLSearchParams(window.location.search).get("session"));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  // A link into one thread from elsewhere in the app (« Modifier avec » on a file) arrives by router.push.
  useEffect(() => {
    if (searchSession) setUrlSessionId(searchSession);
  }, [searchSession]);

  // Its member may rename it and change its picture, where the back office keeps them.
  const canEdit = usePublicConfig().authVia === "backoffice" && !!expert?.catalogueKey;
  const [editOpen, setEditOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  // The header's place for the « … » of Ordinateur and Tableau (the chat renders it there).
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const [dashboardAsked, setDashboardAsked] = useState(false);
  // The phone's tab pills scroll: the current one is brought into view.
  const pillsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    pillsRef.current?.querySelector<HTMLElement>("[aria-current=page]")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [currentTab]);

  const chatPath = agentTabPath(agentId, "chat", profileId);
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
  // Routines, Appels and E-mails too: opened once, they stay mounted, so coming back asks nothing.
  const [opened, setOpened] = useState<ReadonlySet<AgentTab>>(() => new Set([currentTab]));
  if (!opened.has(currentTab)) setOpened(new Set([...opened, currentTab]));

  return (
    <ChatProvider
      agentId={agentId}
      profile={profileId}
      agents={agents}
      urlSessionId={urlSessionId}
      onChatTab={isChat}
      navigateToSession={navigateToSession}
    >
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* The expert heads the page in one row on a computer (Leslie, 28/10, variante B): who (photo with
              the pencil to personalise it, the name with its state beside it, the job), the tabs, then what
              is its own (Ordinateur, Tableau), Appeler and the bell. On a phone: who and its actions, then
              the tabs. Nothing is cut: the header shrinks the name, never a button. */}
          <div className="shrink-0 border-b border-line bg-surface">
            <div className="flex flex-wrap items-center lg:h-16 lg:flex-nowrap lg:gap-5 lg:px-6">
            {expert && (
              // On a computer the tabs start past the conversations' line, level with the chat's own bar
              // (Leslie, 29/10): 288px column + the bar's 28px padding, less the header's 24px padding and 20px gap.
              <div className="order-1 flex min-w-0 flex-1 items-center gap-2.5 px-4 pb-1 pt-2.5 lg:w-[272px] lg:flex-none lg:p-0">
                <span className="relative shrink-0">
                  <ExpertAvatar expert={expert} size="sm" className="lg:hidden" />
                  <ExpertAvatar expert={expert} size="md" className="max-lg:hidden" />
                  {(canEdit || (callee && voiceOn)) && (
                    <button
                      type="button"
                      onClick={() => (canEdit ? setEditOpen(true) : setVoiceOpen(true))}
                      title={`Personnaliser ${expertName}`}
                      aria-label={`Personnaliser ${expertName}`}
                      className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-ink text-surface ring-2 ring-surface after:absolute after:-inset-3 after:content-[''] hover:opacity-85 lg:size-5"
                    >
                      <Pencil className="size-2 lg:size-2.5" />
                    </button>
                  )}
                </span>
                <span className="ml-0.5 min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="truncate font-display text-sm font-bold leading-tight text-ink lg:text-[19px]">{expert.displayName}</span>
                    {profileId && <ExpertReadiness variant="dot" agentId={agentId} profileId={profileId} expertName={expertName} onOpenTools={() => router.push("/integrations/connecteurs")} className="shrink-0 max-lg:text-[11px]" />}
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[10px] text-ink-3 lg:text-[13px]">
                    {expert.role && <span className="truncate max-lg:hidden">{expert.role}</span>}
                    {inbox ? (
                      <button
                        type="button"
                        onClick={copyAddress}
                        title={`Copier l’adresse e-mail : ${inbox.address}`}
                        aria-label="Copier l’adresse e-mail"
                        className="flex min-w-0 items-center gap-1.5 text-left hover:text-ink max-lg:-my-2 max-lg:py-2"
                      >
                        <Mail className="size-3.5 shrink-0 max-lg:hidden" />
                        <span className="truncate lg:hidden">{inbox.address}</span>
                        <Copy className="size-3 shrink-0 lg:hidden" />
                      </button>
                    ) : mail.enabled && expert.catalogueKey ? (
                      <button
                        type="button"
                        onClick={() => selectTab("emails")}
                        title="Attribuer une adresse e-mail à votre expert"
                        aria-label="Attribuer une adresse e-mail à votre expert"
                        className="group relative inline-flex shrink-0 items-center text-ink-3 hover:text-ink max-lg:-my-2 max-lg:py-2"
                      >
                        <span className="relative inline-flex">
                          <Mail className="size-3.5 shrink-0" />
                          <span className="absolute -bottom-1 -right-1 grid size-2.5 place-items-center rounded-full bg-ko text-white ring-1 ring-surface">
                            <X className="size-2 stroke-[3]" />
                          </span>
                        </span>
                        <span
                          role="tooltip"
                          className="pointer-events-none absolute left-1/2 top-full z-40 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1 text-[11px] font-medium text-surface opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                        >
                          Attribuer une adresse e-mail à votre expert
                        </span>
                      </button>
                    ) : null}
                  </span>
                </span>
              </div>
            )}
            <nav ref={pillsRef} className="order-3 flex w-full items-center gap-0.5 overflow-x-auto px-2.5 py-2 max-[389px]:[mask-image:linear-gradient(to_right,black_82%,transparent)] sm:gap-1 sm:px-4 [scrollbar-width:none] lg:order-2 lg:h-full lg:w-auto lg:min-w-0 lg:flex-1 lg:gap-3 lg:p-0 min-[1440px]:gap-5 [&::-webkit-scrollbar]:hidden">
              {tabs.map((t) => {
                const on = currentTab === t.id || (t.id === "chat" && isChat);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => selectTab(t.id)}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "min-h-9 shrink-0 rounded-full px-2 py-1.5 text-[13px] font-semibold sm:px-3 lg:-mb-px lg:inline-flex lg:h-full lg:items-center lg:rounded-none lg:border-b-2 lg:px-0.5 lg:text-[15px]",
                      on ? "bg-tint text-brand-ink lg:border-brand lg:bg-transparent" : "text-ink-2 hover:bg-soft lg:border-transparent lg:hover:bg-transparent lg:hover:text-ink"
                    )}
                  >
                    {t.label}
                  </button>
                );
              })}
            </nav>
            {expert && (
              <div className="order-2 flex shrink-0 items-center gap-2 pr-4 pt-1.5 lg:order-3 lg:p-0">
                {/* « … » with Ordinateur and Tableau, placed here by the chat (they open its panels). */}
                <span ref={setActionsSlot} className="flex items-center gap-2">
                  {/* Until the chat is first opened, the same menu opens it there. */}
                  {profileId && !chatOpened && (
                    <ExpertMoreMenu onAction={() => selectTab("chat")}>
                      {hasScreen(agents.find((a) => a.agent37_id === agentId) ?? null) && <ComputerMenuItem />}
                      <DashboardMenuFace onSelect={() => setDashboardAsked(true)} />
                    </ExpertMoreMenu>
                  )}
                </span>
                {callee && <CallButton expert={callee} iconOnly className="size-11 shrink-0 rounded-full lg:hidden" />}
                {callee && <CallButton expert={callee} className="h-10 shrink-0 rounded-full bg-brand px-4 text-[14.5px] text-on-brand hover:bg-brand/90 max-lg:hidden" />}
                <span className="flex items-center gap-2 max-lg:hidden">
                  <NotificationBell />
                </span>
              </div>
            )}
            </div>
            {callee && voiceOn && <VoiceButton expert={callee} open={voiceOpen} onOpenChange={setVoiceOpen} />}
          </div>
          {/* Chat owns its full height and stays MOUNTED (just hidden) across tab switches. */}
          {chatOpened && (
            <div
              className={cn(
                "relative flex min-h-0 flex-1",
                !isChat && "hidden",
                // « Plein écran »: the chat over the whole window, menu and header included.
                chatFull && isChat && "fixed inset-0 z-40 bg-surface"
              )}
            >
              {/* The conversations open in their own column beside the chat from « Conversations » under
                  Discussion, and close to give the chat its whole width (phones and tablets: a panel).
                  Under 1280 px a column would leave the chat a strip: it floats over the chat instead,
                  like the phone's panel, and closes once a conversation is picked. */}
              {/* The conversations of this space, always beside the chat on a wide screen (search, Tout /
                  Non lues / Routines, periods). Narrower, the chat's header opens them in a panel. */}
              <div className={cn("hidden w-[288px] shrink-0 flex-col border-r border-line bg-surface px-2.5 py-3", !listHidden && "xl:flex")}>
                <ChatSidebar />
              </div>
              <div className="min-w-0 flex-1">
                <ChatView
                  initialMessage={initialMessage}
                  driveFolder={driveFolder ?? (profileId ? `${DRIVE_ROOT}/${expertName}` : DRIVE_ROOT)}
                  actionsSlot={profileId ? actionsSlot : null}
                  onAction={() => selectTab("chat")}
                  openDashboard={dashboardAsked}
                  onDashboardOpened={() => setDashboardAsked(false)}
                />
              </div>
            </div>
          )}
          {/* Files mirrors Chat: full-height, kept MOUNTED so the current directory survives. */}
          {filesOpened && (
            <div className={cn("min-h-0 flex-1", !isFiles && "hidden")}>
              <FilesTab agentId={agentId} initialPath={driveFolder} />
            </div>
          )}
          {/* Routines mount lazily in the padded scroll area. */}
          {opened.has("routines") && profileId && (
            <div className={cn("min-h-0 flex-1 overflow-y-auto", currentTab !== "routines" && "hidden")}>
              <div className="mx-auto w-full max-w-4xl p-6 md:px-10 md:py-8">
                <ExpertRoutines
                  agentId={agentId}
                  active={currentTab === "routines"}
                  expert={{
                    profileId,
                    name: expertName,
                    skills: sheet ? [...sheet.skills.map((s) => s.name), ...sheet.competencies] : [],
                    driveFolder: expert?.driveFolder ?? expertName,
                  }}
                />
              </div>
            </div>
          )}
          {opened.has("calls") && callee && (
            <div className={cn("min-h-0 flex-1 overflow-y-auto", currentTab !== "calls" && "hidden")}>
              <div className="mx-auto w-full max-w-4xl p-6 md:px-10 md:py-8">
                <ExpertCalls expert={callee} />
              </div>
            </div>
          )}
          {opened.has("emails") && profileId && (
            <div className={cn("min-h-0 flex-1 overflow-y-auto", currentTab !== "emails" && "hidden")}>
              <div className="mx-auto w-full max-w-4xl p-6 md:px-10 md:py-8">
                <ExpertEmails inbox={inbox} expertKey={expert?.catalogueKey ?? null} expertName={expertName} loaded={mail.loaded} onCreateInbox={mailAdmin ? mail.createInbox : undefined} onDeleteInbox={mailAdmin ? mail.deleteInbox : undefined} />
              </div>
            </div>
          )}
        </main>
      </div>
      {canEdit && expert?.catalogueKey && (
        <ExpertEditModal
          expertKey={expert.catalogueKey}
          photoUrl={expert.photoUrl}
          open={editOpen}
          onOpenChange={setEditOpen}
          onVoice={callee && voiceOn ? () => setVoiceOpen(true) : undefined}
        />
      )}
    </ChatProvider>
  );
}
