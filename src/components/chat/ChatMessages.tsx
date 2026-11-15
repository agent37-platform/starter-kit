"use client";

import { useSafeDashboard } from "@/components/experts/DashboardProvider";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, ClipboardCheck, Copy, CornerDownLeft, FileText, Image as ImageIcon, Loader2, PhoneCall, Repeat } from "lucide-react";
import { turnDocs, type DriveFile, type TurnDoc } from "@/lib/drive-links";
import { kanbanNotice } from "@/lib/kanban-notice";
import { isRoutineRun, isSilentRun, routinePlainText, SILENT_RUN_LABEL } from "@/lib/routines";
import { isCallTranscript } from "@/lib/voice";
import { isResumeSeed } from "@/lib/conversation-resume";
import { cn } from "@/lib/utils";
import { copyLater } from "@/lib/clipboard";
import { toast } from "sonner";
import { ExpertAvatar } from "@/components/experts/ExpertAvatar";
import { UpdateSpinner, useDeployPhase } from "@/components/app/DeployStatus";
import type { Expert } from "@/lib/types";
import { useChatContext } from "./ChatProvider";
import { DocumentCards, useDriveListing } from "./DocumentCards";
import { GoogleDocCards } from "./GoogleDocs";
import { googleDocs, usedGoogleDocs, withoutGoogleActions, type GoogleDoc } from "@/lib/google-docs";
import { Markdown } from "./Markdown";
import { FilePreview, ReducedImage } from "@/components/files/FilePreview";
import { contentUrl, thumbUrl, type FileEntry } from "@/components/files/types";
import { cleanReply } from "@/lib/chat-errors";
import { mediaTags } from "@/lib/media-tags";
import { LiveWait, StepsList } from "./ChatSteps";
import { ReplyChoices } from "./ReplyActions";
import { replyParts } from "@/lib/reply-parts";
import type { ChatMessage, MessageAttachment } from "./types";
import { commandText } from "@/lib/session-title";

const PAGE = 80;

// Files that rode along with a user turn, above the message bubble: a picture as itself, a reduced copy
// that opens full size (as in Livrables, Leslie 27/10); any other file as a compact chip. Without an
// instance to read from (Yélé's bubble), every file stays a chip.
export function MessageAttachments({ attachments, agentId }: { attachments: MessageAttachment[]; agentId?: string }) {
  const [open, setOpen] = useState<FileEntry | null>(null);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const pictures = agentId ? attachments.filter((a) => a.isImage && !broken.has(a.path)) : [];
  const chips = attachments.filter((a) => !pictures.includes(a));
  return (
    <>
      {pictures.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {pictures.map((a, k) => (
            <button
              key={`${a.path}-${k}`}
              type="button"
              title={a.name}
              aria-label={`Ouvrir ${a.name}`}
              onClick={() => setOpen({ name: a.name, path: a.path, type: "file", size: null, modified: 0, hidden: false })}
              className="block h-40 max-w-[15rem] overflow-hidden rounded-2xl border border-line bg-soft transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              <ReducedImage
                thumb={thumbUrl(agentId!, a.path, 480)}
                original={contentUrl(agentId!, a.path, "inline")}
                alt={a.name}
                onFail={() => setBroken((b) => new Set(b).add(a.path))}
                className="h-full w-auto max-w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
      {chips.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {chips.map((a, k) => (
            <span
              key={`${a.path}-${k}`}
              title={a.name}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink"
            >
              {a.isImage ? (
                <ImageIcon className="h-3.5 w-3.5 shrink-0 text-ink-3" />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0 text-ink-3" />
              )}
              <span className="max-w-[12rem] truncate">{a.name}</span>
            </span>
          ))}
        </div>
      )}
      {agentId && <FilePreview agentId={agentId} entry={open} onClose={() => setOpen(null)} />}
    </>
  );
}

// The expert's reasoning, folded by default (it often comes in English, from the model itself):
// the label says it is thinking, the text opens on demand.
function ThinkingBlock({ content, live }: { content: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  if (!content) return null;
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-1 text-xs text-ink-3 transition-colors hover:text-ink"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>{live ? "Réflexion en cours…" : "Réflexion"}</span>
        {live && <Loader2 className="h-3 w-3 animate-spin" />}
      </button>
      {open && (
        <div className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-line pl-3 text-xs leading-relaxed text-ink-3">
          {content}
        </div>
      )}
    </div>
  );
}

// A routine's run opens with its instructions, sent by the scheduler, not by the member: the routine's
// name and what it asks in plain words, never its commands nor its files (Leslie, 28/10).
function RoutineBrief({ content, name }: { content: string; name: string | null }) {
  const text = routinePlainText(content);
  return (
    <div className="rounded-xl border border-line bg-surface px-3.5 py-2.5">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
        <Repeat className="h-4 w-4 shrink-0 text-ink-3" /> {name ? `Routine « ${name} »` : "Routine"}
      </p>
      {text && <p className="mt-1 pl-6 text-[13.5px] leading-relaxed text-ink-2">{text}</p>}
    </div>
  );
}

// Every message but the live reply, the same array while only the live reply changes: what is derived
// from the finished replies (documents, Google files) is not read again on every delta.
function useSettled(messages: ChatMessage[], liveIndex: number): ChatMessage[] {
  const ref = useRef<ChatMessage[]>([]);
  const next = liveIndex < 0 ? messages : messages.filter((_, i) => i !== liveIndex);
  const prev = ref.current;
  if (prev.length !== next.length || next.some((m, i) => m !== prev[i])) ref.current = next;
  return ref.current;
}

// `face` is the expert whose replies these are: its portrait sits beside each one. Null on the
// instance's default home, which has no persona.
export function ChatMessages({
  messages,
  isStreaming,
  face = null,
  driveFolder = null,
  onShowEarlier,
  onUnqueue,
  onDocs,
  onGoogle,
  routine = null,
  pronoun = null,
  onReply,
}: {
  messages: ChatMessage[];
  isStreaming: boolean;
  face?: Pick<Expert, "displayName" | "photoUrl" | "gateway"> | null;
  /** The expert's folder in the drive: the files written there during a turn get a card. */
  driveFolder?: string | null;
  /** Called before earlier messages are added above, so the view keeps its place. */
  onShowEarlier?: () => void;
  /** Takes back a message still waiting for the reply in progress: it has not been sent. */
  onUnqueue?: (id: string) => void;
  /** Every document of the finished replies, each once: the chat's « Livrables » button lists them. */
  onDocs?: (docs: TurnDoc[]) => void;
  /** The Google documents of the finished replies, each once, the last one used first, with when. */
  onGoogle?: (docs: (GoogleDoc & { usedAt: number | null })[]) => void;
  /** The routine this conversation is a run of, by name. */
  routine?: string | null;
  /** The expert's « elle » or « il »: a command the app sent reads as its button (« Ce qu'elle sait »). */
  pronoun?: "elle" | "il" | null;
  /** Sends a message for the member: a choice clicked. */
  onReply?: (text: string) => void;
}) {
  // The instance whose drive the paths in a reply point into (they become download links).
  const { agentId, profile } = useChatContext();
  const updating = useDeployPhase() === "maintenance";
  // The reply being written: the last assistant bubble, even with queued messages below it.
  // A routine's run: its [SILENT] answer reads as "nothing to report".
  const routineThread = messages.some((m) => m.role === "user" && isRoutineRun(m.content));
  const liveIndex = isStreaming ? messages.findLastIndex((m) => m.role === "assistant") : -1;
  // The drive is listed once for all finished replies (from the oldest, to the minute), again after each turn:
  // it gives the cards their size and date, and tells a made-up path from a real one.
  const settled = useSettled(messages, liveIndex);
  const oldest = useMemo(
    () => settled.reduce<number | null>((min, m) => (m.role === "assistant" && m.at != null && (min == null || m.at < min) ? m.at : min), null),
    [settled]
  );
  // A long conversation (the full history, compressions included) opens on its last messages.
  const [shown, setShown] = useState(PAGE);
  const start = Math.max(0, messages.length - shown);
  const since = oldest == null ? null : Math.floor((oldest - 60_000) / 60_000) * 60_000;
  const listing = useDriveListing(agentId, isStreaming ? null : driveFolder, since, String(messages.length));
  const allDocs = useMemo(() => {
    const seen = new Map<string, TurnDoc>();
    settled.forEach((m) => {
      if (m.role !== "assistant" || !m.content) return;
      for (const d of turnDocs(cleanReply(m.content), listing, [...(m.files ?? []), ...mediaTags(m.content).paths])) seen.set(d.path, d);
    });
    return [...seen.values()];
  }, [settled, listing]);
  useEffect(() => onDocs?.(allDocs), [allDocs, onDocs]);
  const allGoogle = useMemo(
    () => usedGoogleDocs(settled.flatMap((m) => (m.role === "assistant" && m.content ? [{ text: cleanReply(m.content), at: m.at ?? null }] : []))),
    [settled]
  );
  useEffect(() => onGoogle?.(allGoogle), [allGoogle, onGoogle]);
  // Stable across the parent's renders, so the memoized rows stay put while a reply streams.
  const stableFace = useMemo(() => face, [face?.displayName, face?.photoUrl, face?.gateway]); // eslint-disable-line react-hooks/exhaustive-deps
  const handlers = useRef({ onReply, onUnqueue });
  handlers.current = { onReply, onUnqueue };
  const reply = useCallback((text: string) => handlers.current.onReply?.(text), []);
  const unqueue = useCallback((id: string) => handlers.current.onUnqueue?.(id), []);
      const dashboard = useSafeDashboard();

  const handleContainerClick = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest("a");
    if (!target) return;
    const href = target.getAttribute("href") || "";
    const text = (target.textContent || "").toLowerCase();
    const isDashboardLink =
      (href.startsWith("https://mstudio-frames.onrender.com/share/frame/") ||
       href.startsWith("https://yelema-dashboards.onrender.com/share/frame/") ||
       href.startsWith("/modeles/")) &&
      (text.includes("ouvrir le tableau de bord") ||
       text.includes("tableau de bord") ||
       text.includes("ouvrir") ||
       href.includes("/modeles/"));

    if (isDashboardLink) {
      e.preventDefault();
      e.stopPropagation();
      dashboard?.openDashboard(href);
      void dashboard?.refresh();
    }
  };

  return (
    <div onClick={handleContainerClick} className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      {start > 0 && (
        <div className="flex justify-center">
          <button type="button" onClick={() => {
              onShowEarlier?.();
              setShown((n) => n + PAGE);
            }} className="rounded-full border border-line px-3 py-1 text-xs text-ink-3 hover:bg-surface">
            Afficher les messages précédents ({start})
          </button>
        </div>
      )}
      {messages.slice(start).map((m, j) => {
        const i = start + j;
        const live = i === liveIndex;
        return (
          <MessageRow
            key={m.id}
            m={m}
            live={live}
            last={i === messages.length - 1}
            // When the member asked: read for the live reply only (its wait line).
            since={live ? messages.slice(0, i).findLast((x) => x.role === "user")?.at : undefined}
            isStreaming={isStreaming}
            routineThread={routineThread}
            updating={updating}
            face={stableFace}
            agentId={agentId}
            profile={profile}
            listing={listing}
            routine={routine}
            pronoun={pronoun}
            onReply={onReply ? reply : undefined}
            onUnqueue={onUnqueue ? unqueue : undefined}
          />
        );
      })}
    </div>
  );
}

// One message. Memoized: while a reply streams only its own row renders again.
const MessageRow = memo(function MessageRow({
  m,
  live,
  last,
  since,
  isStreaming,
  routineThread,
  updating,
  face,
  agentId,
  profile,
  listing,
  routine,
  pronoun,
  onReply,
  onUnqueue,
}: {
  m: ChatMessage;
  live: boolean;
  last: boolean;
  since: number | undefined;
  isStreaming: boolean;
  routineThread: boolean;
  updating: boolean;
  face: Pick<Expert, "displayName" | "photoUrl" | "gateway"> | null;
  agentId: string;
  profile: string | null;
  listing: DriveFile[];
  routine: string | null;
  pronoun: "elle" | "il" | null;
  onReply?: (text: string) => void;
  onUnqueue?: (id: string) => void;
}) {
    if (m.role === "user" && isCallTranscript(m.content)) {
      return (
        <p className="flex items-center justify-center gap-2 text-xs text-ink-3">
          <PhoneCall className="h-3.5 w-3.5" /> Transcription de l’appel transmise à l’Expert
        </p>
      );
    }
    const notice = m.role === "user" ? kanbanNotice(m.content) : null;
    if (notice) {
      return (
        <p className="flex items-center justify-center gap-2 text-center text-xs text-ink-3">
          <ClipboardCheck className="h-3.5 w-3.5 shrink-0" /> {notice.who} {notice.verb} la tâche confiée : « {notice.title} »
        </p>
      );
    }
    if (m.role === "system") {
      return (
        <p className="flex items-center gap-3 text-center text-xs text-ink-3 before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
          {m.content}
        </p>
      );
    }
    if (m.role === "user" && isResumeSeed(m.content)) {
      return (
        <p className="flex items-center justify-center gap-2 text-center text-xs text-ink-3">
          <CornerDownLeft className="h-3.5 w-3.5 shrink-0" /> Conversation partagée reprise ici : l’Expert en a le contexte
        </p>
      );
    }
    if (m.role === "user" && isRoutineRun(m.content)) {
      return <RoutineBrief content={m.content} name={routine} />;
    }
    if (m.role === "user") {
      const attachments = m.attachments ?? [];
      return (
        <div className="flex justify-end">
          <div className="flex min-w-0 max-w-[85%] flex-col items-end gap-1.5">
            {attachments.length > 0 && <MessageAttachments attachments={attachments} agentId={agentId} />}
            {m.content && (
              <div className={cn("max-w-full whitespace-pre-wrap rounded-[18px] rounded-br-md bg-brand [overflow-wrap:anywhere] px-4 py-2.5 text-[15px] text-on-brand", m.queued && "opacity-60", m.steered && !m.queued && "bg-brand/80")}>
                {commandText(m.content, pronoun)}
              </div>
            )}
            {m.queued && (
              <span className="flex items-center gap-2 text-xs text-ink-3">
                En attente
                {onUnqueue && (
                  <button type="button" onClick={() => onUnqueue(m.id)} className="-my-2 inline-flex min-h-8 items-center rounded-lg px-1.5 font-semibold text-ink-2 hover:bg-soft hover:text-ink">
                    Retirer
                  </button>
                )}
              </span>
            )}
            {m.steered && !m.queued && (
              <span className="flex items-center gap-1 text-xs text-ink-3">
                <CornerDownLeft className="h-3 w-3" /> Ajouté pendant la réponse, pris en compte dans celle-ci
              </span>
            )}
          </div>
        </div>
      );
    }

    const tools = m.tools ?? [];
    // Once the expert works with tools, the turn shows one live step line; its reply appears when the turn ends.
    const working = live && tools.length > 0;
    const showDots = live && !working && !m.content && !m.thinking;
    // Only the conversation's last reply can still be answered in a click; an older question reads as written.
    const finished = !live && m.content ? replyParts(withoutGoogleActions(cleanReply(m.content))) : null;
    const answerable = finished && onReply && !isStreaming && !routineThread && last && finished.choices.length > 0;

    return (
      <div className="flex items-start gap-3">
        {face && <ExpertAvatar expert={face} size="xs" className="mt-0.5" />}
        <div className="min-w-0 max-w-full flex-1 text-[15px] text-ink">
          {m.thinking && <ThinkingBlock content={m.thinking} live={live && !m.content} />}
          {(working || (showDots && !updating)) && <LiveWait tools={tools} name={face?.displayName ?? null} since={since} />}
          {!live && tools.length > 0 && <StepsList tools={tools} />}
          {routineThread && !live && isSilentRun(m.content) ? (
            <p className="text-sm italic text-ink-3">{SILENT_RUN_LABEL}</p>
          ) : m.content && !working ? (
            <Markdown content={!finished ? cleanReply(m.content) : answerable ? finished.body : finished.text} agentId={agentId} profileId={profile} />
          ) : showDots && updating ? (
            // A reply held by the update: said to be received, so the wait does not read as a bug.
            <p role="status" className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3.5 py-2 text-sm font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              <UpdateSpinner />
              {face ? `${face.displayName} reprend` : "Votre Expert reprend"} dans un instant, votre message est bien reçu.
            </p>
          ) : null}
          {answerable && <ReplyChoices choices={finished.choices} note={finished.choicesNote} onSend={onReply} />}
          {!live && m.content && <GoogleDocCards docs={googleDocs(cleanReply(m.content))} />}
          {!live && m.content && <DocumentCards agentId={agentId} docs={turnDocs(cleanReply(m.content), listing, [...(m.files ?? []), ...mediaTags(m.content).paths])} />}
          {!live && m.content && !(routineThread && isSilentRun(m.content)) && <CopyReply text={cleanReply(m.content)} />}
        </div>
      </div>
    );
});

// Under each finished reply: copies its text, as « Copier » under a ChatGPT answer.
function CopyReply({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await copyLater(Promise.resolve(text));
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      toast.error("La réponse n’a pas pu être copiée. Réessayez.");
    }
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label="Copier la réponse"
      title="Copier la réponse"
      className="-mb-2 -ml-3 mt-0.5 flex size-11 items-center justify-center rounded-lg text-ink-3 hover:bg-surface hover:text-ink"
    >
      {done ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}
