"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, Plus, Sparkles } from "lucide-react";
import { ComputerButton, ComputerDialog, ComputerPanel } from "@/components/experts/ExpertComputer";
import { DashboardProvider } from "@/components/experts/DashboardProvider";
import { DashboardButton, DashboardPanel, DashboardDialog, OpenDashboardOnMount, ShareDashboardModal, SidePanelSync } from "@/components/experts/ExpertDashboard";
import { ExpertAvatar } from "@/components/experts/ExpertAvatar";
import { useExpertsContext } from "@/components/experts/ExpertsProvider";
import { expertDisplayName } from "@/lib/experts";
import { cn } from "@/lib/utils";
import { agentTabPath } from "@/lib/expert-tabs";
import { citedFolder, type TurnDoc } from "@/lib/drive-links";
import { ConversationDocs } from "./ConversationDocs";
import { PreviewSiblings } from "@/components/files/preview-siblings";
import { GoogleDocsRow, PinnedDocsProvider, usePinnedDocs } from "./GoogleDocs";
import type { GoogleDoc } from "@/lib/google-docs";
import { DropOverlay } from "@/components/DropOverlay";
import { useRouter, useSearchParams } from "next/navigation";
import { ChatComposer } from "./ChatComposer";
import { ExpertReadiness } from "@/components/experts/ExpertReadiness";
import { useVoiceExpert } from "@/components/voice/useVoiceExpert";
import type { Stage } from "@/lib/jour-zero";
import { ChatMessages } from "./ChatMessages";
import { ChatSessionsPanel } from "./ChatSessionsPanel";
import { setChatFull, setChatListHidden, useChatFull, useChatListHidden, useChatSidePanel } from "./chat-layout";
import { useChatContext } from "./ChatProvider";
import { useChat } from "./useChat";
import { wakeInstance } from "@/components/app/wake";
import { useChatAttachments } from "./useChatAttachments";
import { rememberedSettings } from "./rememberedSettings";

// The conversation pane, rendered full-height in the chat tab's main column. Empty state = a
// centered welcome (heading + big composer + subtitle); once there are messages it becomes a
// scrolling transcript with the composer docked at the bottom. The composer is kept at a STABLE
// position in the tree across both states so it never remounts (preserving the draft, model, and
// effort selection through the first send).
// The image, and its first revision, that stream the instance's screen (Yelema-ai/yelema-hermes).
const SCREEN_TEMPLATE = "yelema-hermes";
const SCREEN_MIN_REVISION = 5;


/** Conversations after which « Faire connaissance » is no longer offered. */
const INTRO_MAX = 10;
export const hasScreen = (instance: { image: { template: string; revision: number | null } | null } | null) =>
  instance?.image?.template === SCREEN_TEMPLATE && (instance.image.revision ?? 0) >= SCREEN_MIN_REVISION;

// `driveFolder`: the expert's folder in the drive, where the documents of its replies are looked for.
export function ChatView({
  initialMessage,
  driveFolder = null,
  actionsSlot = null,
  onAction,
  openDashboard = false,
  onDashboardOpened,
}: {
  initialMessage?: string | null;
  driveFolder?: string | null;
  /** On an expert's page, its header: « Ordinateur » and « Tableau » sit there, beside its name (Leslie, 28/10). */
  actionsSlot?: HTMLElement | null;
  /** Called on a click on one of them, so the Discussion shows where its panel opens. */
  onAction?: () => void;
  /** « Tableau » was clicked in the header before the chat was ever opened: opened once mounted. */
  openDashboard?: boolean;
  onDashboardOpened?: () => void;
}) {
  const {
    agentId,
    profile,
    agents,
    sessions,
    activeSessionId,
    composerFocusToken,
    requestComposerFocus,
    startNewChat,
    onSessionCreated,
    registerRunKiller,
    bumpSession,
    threadVersion,
  } = useChatContext();
  const { messages, isStreaming, loadingHistory, error, send, stop, killRun, unqueue } = useChat({
    agentId,
    profile,
    sessionId: activeSessionId,
    refreshToken: threadVersion,
    onSessionCreated,
    onActivity: bumpSession,
  });

  // The instance may be asleep: woken as the chat opens, not when the first message is sent.
  useEffect(() => wakeInstance(agentId), [agentId]);

  // Deleting a thread from the rail must also stop any turn still streaming on it.
  useEffect(() => registerRunKiller(killRun), [registerRunKiller, killRun]);

  // Attachment state lives here (not in the composer) so the ENTIRE pane is a drop zone — a file
  // dropped anywhere over the transcript or composer lands in the same tray. A landed attachment
  // refocuses the composer through the same shared signal selecting/creating a thread uses.
  const att = useChatAttachments(agentId, requestComposerFocus);
  const { clearFiles } = att;

  // Switching threads / starting a new chat empties the staged tray, so a file picked for one
  // conversation can't silently ride along into the next.
  // « Modifier avec <Expert> » from a file's preview (?ref=): the file comes pinned above the field
  // of the conversation it opened on, and leaves the address so a refresh does not pin it again. Kept
  // while that conversation stays open (the tray is emptied again as the rail loads); another
  // conversation drops it (Myriel, Leslie 30/10).
  const { addReference } = att;
  // The chat stays mounted while another tab of the expert shows: the address is read as it changes.
  const params = useSearchParams();
  const refParam = params.get("ref");
  const pinned = useRef<{ path: string; session: string | null } | null>(null);
  useEffect(() => {
    clearFiles();
    const p = pinned.current;
    if (!p) return;
    if ((activeSessionId ?? null) !== p.session) {
      pinned.current = null;
      return;
    }
    addReference(p.path);
  }, [activeSessionId, clearFiles, addReference]);
  useEffect(() => {
    if (!refParam) return;
    const url = new URL(window.location.href);
    pinned.current = { path: refParam, session: url.searchParams.get("session") };
    if ((activeSessionId ?? null) === pinned.current.session) addReference(refParam);
    url.searchParams.delete("ref");
    window.history.replaceState(window.history.state, "", url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refParam]);

  // A message handed over by the home page ("Demander à mon équipe") is sent once, into a new
  // thread, and dropped from the URL so a refresh does not send it again.
  const sentInitial = useRef(false);
  useEffect(() => {
    if (!initialMessage || sentInitial.current || activeSessionId) return;
    sentInitial.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("q");
    window.history.replaceState(window.history.state, "", url);
    // Sent with the model and effort chosen on the home's chat bar.
    const { model, provider, reasoningEffort } = rememberedSettings();
    void send(initialMessage, { model, provider, reasoningEffort });
  }, [initialMessage, activeSessionId, send]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Whether the user is pinned near the bottom — controls whether new tokens auto-scroll.
  const stickRef = useRef(true);
  // The distance from the bottom kept while earlier messages load above; dropped as soon as the user scrolls.
  const holdRef = useRef<number | null>(null);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  const release = () => {
    holdRef.current = null;
  };

  // A conversation opens on its last message.
  useEffect(() => {
    stickRef.current = true;
    holdRef.current = null;
  }, [activeSessionId]);

  const settle = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickRef.current) el.scrollTop = el.scrollHeight;
    else if (holdRef.current != null) el.scrollTop = el.scrollHeight - holdRef.current;
  }, []);
  useEffect(settle, [messages, loadingHistory, settle]);
  // Replies, cards and pictures lay out after the render: follow them too.
  const hasMessages = messages.length > 0;
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new ResizeObserver(settle);
    observer.observe(el);
    return () => observer.disconnect();
  }, [settle, hasMessages, loadingHistory]);
  const showEarlier = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = false;
    holdRef.current = el.scrollHeight - el.scrollTop;
  }, []);

  const showWelcome = !loadingHistory && messages.length === 0;
  // Memoized so the per-token re-renders during streaming don't re-scan the thread list.
  const activeTitle = useMemo(
    () => {
      // A routine's run is titled by the routine, as in the list, never by Hermes's instructions.
      const s = sessions.find((x) => x.session_id === activeSessionId);
      return (s?.routine ?? s?.title)?.trim();
    },
    [sessions, activeSessionId]
  );
  const headerTitle = activeTitle || (activeSessionId ? "Discussion" : "Nouvelle discussion");
  // The expert this chat talks to, dressed by the catalogue (name, portrait); null on the
  // instance's default home or while the list loads.
  const router = useRouter();
  const { experts } = useExpertsContext();
  const voiceExpert = useVoiceExpert();
  const expert = useMemo(
    () => (profile ? (experts.find((e) => e.agentId === agentId && e.profileId === profile) ?? null) : null),
    [experts, agentId, profile]
  );
  const pronoun = expert?.catalogueKey ? voiceExpert(expert.catalogueKey).pronoun : null;
  // Before « Faire connaissance », it is the one action shown: the catalogue's requests wait (Leslie, 31/10).
  const [prepStage, setPrepStage] = useState<Stage | null>(null);
  // « Faire connaissance » goes once done, or once the member has had INTRO_MAX conversations with the
  // expert without it: by then they know each other (Leslie, 03/11: « il doit disparaître après un certain temps »).
  const conversations = sessions.filter((x) => !x.routine).length;
  const showIntro = Boolean(profile) && prepStage === "intro" && conversations < INTRO_MAX;
  const instance = useMemo(() => agents.find((x) => x.agent37_id === agentId) ?? null, [agents, agentId]);
  // The expert's name when the chat targets one; the company chat otherwise (never the instance's
  // name, which the back office writes as the list of its Experts).
  const agentName = profile ? (expert?.displayName ?? expertDisplayName(profile)) : "Chat d’entreprise";
  // The avatar shown in the header, the welcome and beside each reply.
  const face = profile ? { displayName: agentName, photoUrl: expert?.photoUrl ?? null, gateway: null } : null;
  // "Son ordinateur" needs the screen the yelema-hermes image streams, from its revision 5 on
  // (image v1.1.0); an instance on another image, or on an older revision, has none to show.
  const listHidden = useChatListHidden();
  const full = useChatFull();
  const sidePanel = useChatSidePanel();
  const hasComputer = Boolean(profile) && hasScreen(instance);

  // The documents this discussion produced: the « Livrables » button of the chat's bar lists them.
  const [docs, setDocs] = useState<TurnDoc[]>([]);
  // The Google documents this discussion uses, the last one used first (Leslie, 31/10).
  const [google, setGoogle] = useState<(GoogleDoc & { usedAt: number | null })[]>([]);
  useEffect(() => {
    setDocs([]);
    setGoogle([]);
  }, [activeSessionId]);
  // The documents the client keeps first above this conversation (Leslie, 03/11).
  const pins = usePinnedDocs(activeSessionId ? `${agentId}:${profile ?? ""}:${activeSessionId}` : null);
  const docsFolder = (docs[0] && citedFolder(docs[0].path.slice(0, docs[0].path.lastIndexOf("/")))) || driveFolder;
  const docsHref = `${agentTabPath(agentId, "files", profile)}${docsFolder ? `?dossier=${encodeURIComponent(docsFolder)}` : ""}`;
  const inHeader = Boolean(profile && actionsSlot);

    const handleTriggerTableau = useCallback(() => {
    void send("/tableau");
  }, [send]);

  return (
    <DashboardProvider
      agentId={agentId}
      profile={profile}
      agentName={agentName}
      onTriggerTableau={handleTriggerTableau}
      isStreaming={isStreaming}
      messages={messages}
    >
    <PinnedDocsProvider value={pins}>
    <PreviewSiblings.Provider value={docs}>
    <SidePanelSync hasComputer={hasComputer} />
    {openDashboard && onDashboardOpened && <OpenDashboardOnMount onDone={onDashboardOpened} />}
    <div className="flex h-full min-h-0">
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col wide:min-w-[400px]" {...att.dragHandlers}>
      {att.dragOver && <DropOverlay label="Déposez vos fichiers pour les joindre" />}
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <ChatSessionsPanel />
          {/* Wide screen: the column of conversations folds away and comes back from here. */}
          <button
            type="button"
            onClick={() => setChatListHidden(!listHidden)}
            aria-label={listHidden ? "Afficher les conversations" : "Masquer les conversations"}
            title={listHidden ? "Afficher les conversations" : "Masquer les conversations"}
            className="-ml-1.5 hidden size-9 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-soft hover:text-ink xl:grid"
          >
            {listHidden ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>
          {/* On an expert's page its photo and name already head the page: shown once. */}
          {face && !profile && <ExpertAvatar expert={face} size="sm" />}
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold leading-tight text-ink">{headerTitle}</h1>
            {/* The company chat: never the instance's name (the back office names it after its Experts). */}
            {!profile && <p className="truncate text-xs text-ink-3">{agentName}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
        {profile && messages.length > 0 && <ConversationDocs agentId={agentId} docs={docs} google={google} folderHref={docsHref} />}
        {inHeader && actionsSlot ? (
          createPortal(
            <span className="contents" onClickCapture={onAction}>
              {hasComputer && <ComputerButton inHeader />}
              <DashboardButton inHeader />
            </span>,
            actionsSlot
          )
        ) : (
          <>
            {hasComputer && <ComputerButton />}
            {Boolean(profile) && <DashboardButton />}
          </>
        )}
        {/* An expert's new conversation lives in its list of conversations (Leslie, 28/10). */}
        {!profile && (
        <button
          type="button"
          onClick={startNewChat}
          aria-label="Nouvelle conversation"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-soft"
        >
          <Plus className="h-4 w-4" />
          {/* Beside an open panel the chat is narrow: the icon says enough, the title keeps its room. */}
          <span className={cn("hidden sm:inline", sidePanel && "wide:hidden")}>Nouvelle conversation</span>
        </button>
        )}
        {/* Plein écran: in the corner, where a window is enlarged. */}
        <button
          type="button"
          onClick={() => setChatFull(!full)}
          aria-label={full ? "Réduire" : "Plein écran"}
          title={full ? "Réduire (Échap)" : "Plein écran"}
          className="hidden size-9 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-soft hover:text-ink lg:grid"
        >
          {full ? <Minimize2 className="h-[18px] w-[18px]" /> : <Maximize2 className="h-[18px] w-[18px]" />}
        </button>
        </div>
      </header>
      {messages.length > 0 && <GoogleDocsRow docs={google} />}
      {/* Top: scrolling transcript when there are messages; the centered welcome heading when
          empty (justify-end seats it just above the composer). */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onWheel={release}
        onTouchMove={release}
        onKeyDown={release}
        className={cn(
          "min-h-0",
          showWelcome ? "flex flex-1 flex-col items-center justify-end px-4 pb-4" : "flex-1 overflow-y-auto"
        )}
      >
        {loadingHistory ? (
          <div className="flex h-full items-center justify-center text-ink-3">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : messages.length > 0 ? (
          <div ref={contentRef}>
            <ChatMessages messages={messages} isStreaming={isStreaming} face={face} driveFolder={driveFolder} onReply={(text) => void send(text)} onShowEarlier={showEarlier} onUnqueue={unqueue} onDocs={setDocs} onGoogle={setGoogle} routine={sessions.find((s) => s.session_id === activeSessionId)?.routine ?? null} pronoun={pronoun} />
          </div>
        ) : (
          <>
            {face && !profile && <ExpertAvatar expert={face} size="lg" className="mb-4 max-sm:hidden" />}
          <h1 className="text-center font-display text-[26px] font-bold tracking-tight text-ink sm:text-[30px]">
            {profile ? `Que voulez-vous confier à ${agentName} ?` : "Que puis-je faire pour vous ?"}
          </h1>
            {expert?.tagline && <p className="mt-2 max-w-md text-center text-[15px] text-ink-2">{expert.tagline}</p>}
          </>
        )}
      </div>

      {/* Composer wrapper — the STABLE 2nd child. Docked, it leaves the bottom-right corner to Yélé. Its chrome (docked vs bare centered) is a
          className swap so the ChatComposer inside never changes tree position. */}
      <div onFocusCapture={() => wakeInstance(agentId)} className={cn("relative", showWelcome ? "w-full px-4 sm:px-6" : "bg-background px-4 py-3 sm:py-4 sm:pl-6 sm:pr-24")}>
        {/* No hard divider — a short fade dissolves the transcript into the composer instead. */}
        {!showWelcome && (
          <div className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-background to-transparent" />
        )}
        <div className={cn("mx-auto w-full", showWelcome ? "max-w-2xl" : "max-w-3xl")} aria-live="polite">
          {error && <p className="mb-2 rounded-xl bg-ko-pale px-3 py-2 text-[13px] text-ko">{error}</p>}
        </div>
        {profile && showWelcome && (
          <ExpertReadiness
            variant="banner"
            agentId={agentId}
            profileId={profile}
            expertName={agentName}
            pronoun={pronoun}
            onCommand={(text) => void send(text)}
            onStage={setPrepStage}
            onOpenTools={() => router.push("/integrations/connecteurs")}
            className={cn("mb-3", showWelcome && "max-w-2xl")}
          />
        )}
        <ChatComposer
          agentId={agentId}
          isStreaming={isStreaming}
          att={att}
          onSend={send}
          onStop={stop}
          large={showWelcome}
          focusToken={composerFocusToken}
        />
      </div>

      {/* Bottom: balances the vertical centering and carries the welcome subtitle. */}
      {showWelcome && (
        <div className="flex flex-1 flex-col items-center px-4 pt-3">
          {/* Only « Faire connaissance », and only for a while: the catalogue's requests are gone, and nothing
              takes their place, no help sentence either (Leslie, 03/11: « simplifier au max »). */}
          {showIntro && (
            <button
              type="button"
              onClick={() => void send("/onboarding")}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-brand bg-tint px-3.5 py-1.5 text-[13.5px] font-semibold text-brand-ink transition-colors hover:bg-brand hover:text-on-brand"
            >
              <Sparkles className="size-4" /> Faire connaissance avec {agentName}
            </button>
          )}
        </div>
      )}
    </div>
      {hasComputer && (
        <>
          <ComputerPanel expert={{ name: agentName }} busy={isStreaming} onTakeOver={stop} />
          <ComputerDialog expert={{ name: agentName }} busy={isStreaming} onTakeOver={stop} onWrite={requestComposerFocus} />
        </>
      )}
      {Boolean(profile) && (
        <>
          <DashboardPanel />
          <DashboardDialog />
          <ShareDashboardModal />
        </>
      )}
    </div>
    </PreviewSiblings.Provider>
    </PinnedDocsProvider>
    </DashboardProvider>
  );
}
