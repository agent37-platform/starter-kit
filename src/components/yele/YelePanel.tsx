"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, BarChart3, Maximize2, Bug, ChevronLeft, History, KeyRound, Loader2, Mic, Plug, Receipt, Repeat, FileSpreadsheet, ShieldCheck, Send, Sparkles, SquarePen, Users, X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { profileQuery } from "@/lib/profile-id";
import { useChat } from "@/components/chat/useChat";
import { AttachButton, AttachmentTray } from "@/components/chat/Attachments";
import { DictationBar } from "@/components/chat/ChatComposer";
import { MessageAttachments } from "@/components/chat/ChatMessages";
import { DropOverlay } from "@/components/DropOverlay";
import { useChatAttachments } from "@/components/chat/useChatAttachments";
import { useDictation } from "@/components/chat/useDictation";
import { useVoices } from "@/components/voice/useVoices";
import { Markdown } from "@/components/chat/Markdown";
import { useCallState } from "@/components/voice/CallProvider";
import { CallButton } from "@/components/voice/CallButton";
import type { Companion } from "@/lib/companion";
import { cn } from "@/lib/utils";
import { toMs } from "@/lib/activity";
import { agentTabPath } from "@/lib/expert-tabs";
import { Portrait, YELE_FACE } from "./YelePortrait";

// Yélé's open panel, loaded on first opening: the chat and its Markdown stay out of the shell.
type Shortcut = { label: string; desc: string; prompt: string; icon: LucideIcon };
type PastSession = { session_id: string; title: string | null; last_active: number };

const SHORTCUTS: Shortcut[] = [
  { label: "Activité des Experts", desc: "Qui a travaillé aujourd'hui ?", prompt: "Qui a travaillé aujourd'hui parmi mes experts et quelles ont été leurs activités ?", icon: BarChart3 },
  { label: "Derniers Livrables", desc: "Documents récents créés", prompt: "Quels sont les derniers livrables et documents produits par mes experts ?", icon: FileSpreadsheet },
  { label: "Santé des outils", desc: "Connecteurs et comptes", prompt: "Peux-tu faire un audit de l'état de mes connecteurs et outils ?", icon: ShieldCheck },
  { label: "Connecter mes outils", desc: "Drive, Telegram, MCP…", prompt: "Je voudrais connecter les outils de mon entreprise à mes Experts.", icon: Plug },
  { label: "Recruter un Expert", desc: "Trouver le bon profil", prompt: "Je voudrais recruter un nouvel Expert.", icon: Users },
  { label: "Ma consommation", desc: "Forfait et usage", prompt: "Je voudrais comprendre ma consommation et mon forfait.", icon: Receipt },
  { label: "Créer une routine", desc: "Une tâche récurrente", prompt: "Je voudrais qu'un Expert fasse une tâche régulièrement pour moi.", icon: Repeat },
  { label: "Signaler un problème", desc: "Aide et support", prompt: "J'ai besoin d'aide ou je rencontre un problème sur Yelema.", icon: Bug },
];

// Shortcuts that fit the page the member is on come first.
function pageShortcuts(path: string): Shortcut[] {
  if (path.startsWith("/integrations/modeles"))
    return [{ label: "Brancher ma clé d’IA", desc: "OpenAI, Anthropic, Gemini…", prompt: "Comment je branche la clé d'IA de mon entreprise sur mes Experts ?", icon: KeyRound }];
  if (path.startsWith("/integrations"))
    return [{ label: "Brancher Gmail", desc: "Pour que vos Experts lisent vos e-mails", prompt: "Comment je branche Gmail à mes Experts ?", icon: Plug }];
  if (path.startsWith("/parametres/facturation"))
    return [{ label: "Ma dernière facture", desc: "Ce qu’elle contient", prompt: "Explique-moi ma dernière facture.", icon: Receipt }];
  if (path.startsWith("/recruter"))
    return [{ label: "Quel Expert pour moi ?", desc: "Selon votre besoin", prompt: "Aide-moi à choisir l'Expert qu'il me faut.", icon: Users }];
  const expert = path.match(/^\/experts\/[^/]+\/[^/_]*__([^/]+)/)?.[1];
  if (expert) {
    const name = decodeURIComponent(expert).replace(/^./, (c) => c.toUpperCase());
    return [{ label: `Bien travailler avec ${name}`, desc: "Ce qu’il sait faire", prompt: `Que peut faire ${name} pour moi, et comment bien lui demander ?`, icon: Sparkles }];
  }
  return [];
}

// The pages a reply of Yélé names, to open them in one tap (« Ouvrir Intégrations »).
const PAGES: { word: RegExp; label: string; href: string }[] = [
  { word: /\bconnecteurs?\b/i, label: "Connecteurs", href: "/integrations/connecteurs" },
  { word: /\bcanaux\b/i, label: "Canaux", href: "/integrations/canaux" },
  { word: /\bmod[eè]les\b/i, label: "Modèles", href: "/integrations/modeles" },
  { word: /\bMCP\b/, label: "MCP", href: "/integrations/mcp" },
  { word: /\bint[eé]grations\b/i, label: "Intégrations", href: "/integrations" },
  { word: /\bfacturation\b/i, label: "Facturation", href: "/parametres/facturation" },
  { word: /\brecruter\b/i, label: "Recruter", href: "/recruter" },
];
function pagesIn(text: string, here: string) {
  const found = PAGES.filter((p) => p.word.test(text) && here !== p.href);
  // A tab of Intégrations makes the Intégrations button useless.
  const tab = found.some((p) => p.href.startsWith("/integrations/"));
  return found.filter((p) => !(tab && p.href === "/integrations")).slice(0, 3);
}

// When each Yélé discussion was last active, as in the conversations rail.
function shortWhen(at: number): string {
  const ms = toMs(at);
  const d = new Date(ms);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (ms >= today.getTime()) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

// The open discussion is kept per instance, across tabs and visits: another space never reopens it.
const sessionKey = (c: Companion) => `yele-session:${c.agentId}`;

function readSession(c: Companion): string | null {
  try {
    return localStorage.getItem(sessionKey(c));
  } catch {
    return null;
  }
}

function keepSession(c: Companion, id: string | null): void {
  try {
    if (id) localStorage.setItem(sessionKey(c), id);
    else localStorage.removeItem(sessionKey(c));
  } catch {}
}

export function YelePanel({ companion, folded, onClose }: { companion: Companion; folded: boolean; onClose: () => void }) {
  const [sessionId, setSessionId] = useState<string | null>(() => readSession(companion));
  const [input, setInput] = useState("");
  // « Anciennes discussions »: Yélé's past discussions, read from the instance (null = list closed).
  const [past, setPast] = useState<PastSession[] | "loading" | null>(null);
  // The last discussions, offered on Yélé's home view so they are found without looking for them.
  const [recent, setRecent] = useState<PastSession[]>([]);
  const path = usePathname() ?? "";
  const shortcuts = [...pageShortcuts(path), ...SHORTCUTS];
  const scrollRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // The field follows its text up to about five lines, then scrolls.
  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  };
  // Like an Expert's chat: files ride along (paper clip, drop, paste) and the microphone dictates.
  const att = useChatAttachments(companion.agentId, () => fieldRef.current?.focus());
  const canDictate = useVoices().length > 0;
  const dictation = useDictation({
    expert: null,
    onText: (said) => {
      setInput((prev) => (prev.trim() ? `${prev.trim()} ${said}` : said));
      requestAnimationFrame(() => {
        if (!fieldRef.current) return;
        grow(fieldRef.current);
        fieldRef.current.focus();
      });
    },
    onError: (message) => toast.error(message),
  });
  const dictating = dictation.state !== "idle";
  const { active: onCall } = useCallState();
  const { messages, isStreaming, loadingHistory, error, send } = useChat({
    agentId: companion.agentId,
    profile: companion.profileId,
    sessionId,
    onSessionCreated: (id) => {
      setSessionId(id);
      keepSession(companion, id);
    },
  });

  const canSend = (input.trim().length > 0 || att.hasFiles) && !att.blocksSend && !dictating && !isStreaming;
  // A call already holds the microphone: a dictation under way gives way.
  useEffect(() => {
    if (onCall && dictation.state !== "idle") dictation.cancel();
  }, [onCall, dictation]);

  useEffect(() => {
    apiFetch<{ sessions: PastSession[] }>(`/api/agents/${companion.agentId}/chat/sessions${profileQuery(companion.profileId)}`)
      .then((r) => setRecent([...r.sessions].sort((a, b) => b.last_active - a.last_active)))
      .catch(() => setRecent([]));
  }, [companion.agentId, companion.profileId, sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, isStreaming]);

  // A remembered discussion that no longer opens (deleted, instance reset) would leave the panel on an
  // error with no way out: start a new one instead.
  useEffect(() => {
    if (error && sessionId && messages.length === 0 && !isStreaming) restart();
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    const attachments = att.takeAttachments();
    send(input, { files: attachments.map((a) => a.path), attachments });
    setInput("");
    if (fieldRef.current) fieldRef.current.style.height = "auto";
  }

  function restart() {
    setSessionId(null);
    keepSession(companion, null);
    setPast(null);
  }

  function openPast() {
    setPast("loading");
    // A list closed while it loads stays closed.
    apiFetch<{ sessions: PastSession[] }>(`/api/agents/${companion.agentId}/chat/sessions${profileQuery(companion.profileId)}`)
      .then((r) => setPast((p) => (p === "loading" ? [...r.sessions].sort((a, b) => b.last_active - a.last_active) : p)))
      .catch(() => setPast((p) => (p === "loading" ? null : p)));
  }

  function reopen(id: string) {
    setSessionId(id);
    keepSession(companion, id);
    setPast(null);
  }

  // On a phone the panel covers the page: following a link closes it.
  const leave = () => {
    if (!window.matchMedia("(min-width: 640px)").matches) onClose();
  };

  // The answer not started yet is not an empty bubble: « Yélé réfléchit… » says she is on it.
  const shown = messages.filter((m) => m.role !== "system" && !(m.role === "assistant" && !m.content.trim() && isStreaming && m === messages[messages.length - 1]));
  const thinking = isStreaming && shown[shown.length - 1]?.role !== "assistant";

  return (
    <div role="dialog" aria-label="Yélé, accompagnement" className={cn(
        // Full screen on a phone (like a messaging app), a floating card from the tablet up.
        "fixed inset-0 z-[60] flex h-dvh flex-col overflow-hidden bg-surface pt-[env(safe-area-inset-top)] sm:inset-auto sm:right-6 sm:z-50 sm:h-[580px] sm:w-[420px] sm:rounded-[26px] sm:border sm:border-line sm:pt-0 sm:shadow-[0_20px_50px_rgba(0,0,0,0.22)]",
        // Low in its corner like any chat, over the bubble it replaces (a folded call keeps its place).
        folded ? "sm:bottom-48 sm:max-h-[calc(100dvh-14rem)]" : "sm:bottom-6 sm:max-h-[calc(100dvh-3rem)]"
      )} {...att.dragHandlers}>
      {att.dragOver && <DropOverlay label="Déposez vos fichiers pour Yélé" />}
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-3">
          <Portrait animated />
          <div>
            <p className="text-[15px] font-bold text-ink">Yélé</p>
            <p className="text-[12.5px] leading-snug text-ink-3">Prise en main, conseils et support</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Yélé se joint aussi par la voix, comme dans l'app mobile (Leslie, 01/11). */}
          {/* Sa page entière : ses discussions, appels, livrables et routines, au lieu de les chercher
              dans les notifications (Leslie, 01/11). */}
          <Link href={agentTabPath(companion.agentId, "chat", companion.profileId)} onClick={onClose} title="Agrandir" aria-label="Agrandir : l’espace de Yélé" className="grid size-10 place-items-center rounded-lg text-ink-2 hover:bg-soft hover:text-ink">
            <Maximize2 className="size-4" />
          </Link>
          <CallButton expert={{ key: companion.profileId, name: "Yélé", photoUrl: YELE_FACE }} iconOnly label="Appeler" className="size-10 rounded-lg bg-transparent text-ink-2 shadow-none hover:bg-soft hover:text-ink" />
          <button type="button" onClick={() => (past ? setPast(null) : openPast())} title="Anciennes discussions" aria-label="Anciennes discussions" aria-pressed={!!past} className={cn("flex h-10 items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold hover:bg-soft hover:text-ink", past ? "bg-soft text-ink" : "text-ink-2")}>
            <History className="size-4" /> Historique
          </button>
          {(shown.length > 0 || past) && (
            <button type="button" onClick={restart} title="Nouvelle discussion" aria-label="Nouvelle discussion" className="grid size-10 place-items-center rounded-lg text-ink-3 hover:bg-soft hover:text-ink">
              <SquarePen className="size-4" />
            </button>
          )}
          <button type="button" onClick={onClose} title="Réduire" aria-label="Réduire" className="grid size-10 place-items-center rounded-lg text-ink-3 hover:bg-soft hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {past ? (
          <>
            <button type="button" onClick={() => setPast(null)} className="flex min-h-10 items-center gap-1 text-[13px] font-semibold text-ink-2 hover:text-ink">
              <ChevronLeft className="size-4" /> Anciennes discussions
            </button>
            {past === "loading" ? (
              <p className="flex items-center gap-2 text-[13px] text-ink-3">
                <Loader2 className="size-3.5 animate-spin" /> Chargement…
              </p>
            ) : past.length === 0 ? (
              <p className="text-[13px] text-ink-3">Aucune discussion pour l’instant.</p>
            ) : (
              <nav className="flex flex-col gap-0.5">
                {past.map((p) => (
                  <button key={p.session_id} type="button" onClick={() => reopen(p.session_id)} className={cn("flex min-h-11 items-center gap-2 rounded-xl px-3 text-left text-[14px] hover:bg-soft", p.session_id === sessionId ? "bg-soft-2 font-semibold text-ink" : "text-ink-2")}>
                    <span className="min-w-0 flex-1 truncate">{p.title || "Discussion avec Yélé"}</span>
                    <span className="shrink-0 text-[12px] tabular-nums text-ink-3">{shortWhen(p.last_active)}</span>
                  </button>
                ))}
              </nav>
            )}
          </>
        ) : shown.length === 0 && loadingHistory ? (
          <p className="flex items-center gap-2 pl-1 text-[13px] text-ink-3">
            <Loader2 className="size-3.5 animate-spin text-brand" /> Chargement de la discussion…
          </p>
        ) : shown.length === 0 && !isStreaming ? (
          <>
            <div className="flex items-start gap-2.5 rounded-2xl border border-brand/20 bg-tint/50 p-3.5">
              <Sparkles className="mt-0.5 size-5 shrink-0 text-brand" />
              <p className="text-[14px] leading-relaxed text-ink-2">
                Bonjour, je suis <span className="font-bold text-brand">Yélé</span>. Je vous aide à tirer le meilleur de vos Experts, à brancher vos outils et à régler un blocage.
              </p>
            </div>
            {recent.length > 0 && (
              <div>
                <p className="px-1 pb-1 text-[12px] font-bold uppercase tracking-[0.05em] text-ink-3">Reprendre une discussion</p>
                <nav className="flex flex-col gap-0.5">
                  {recent.slice(0, 3).map((p) => (
                    <button key={p.session_id} type="button" onClick={() => reopen(p.session_id)} className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-left text-[14px] text-ink-2 hover:bg-soft">
                      <History className="size-4 shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1 truncate">{p.title || "Discussion avec Yélé"}</span>
                      <span className="shrink-0 text-[12px] tabular-nums text-ink-3">{shortWhen(p.last_active)}</span>
                    </button>
                  ))}
                </nav>
                {recent.length > 3 && (
                  <button type="button" onClick={openPast} className="mt-0.5 min-h-10 px-3 text-[13px] font-semibold text-brand-ink hover:underline">
                    Tout l’historique ({recent.length})
                  </button>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {shortcuts.map(({ label, desc, prompt, icon: Icon }) => (
                <button key={label} type="button" onClick={() => send(prompt)} disabled={isStreaming} className="flex flex-col items-start gap-1 rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:border-brand/30 hover:bg-soft disabled:opacity-50">
                  <Icon className="size-4 text-brand" />
                  <span className="line-clamp-1 text-[13.5px] font-semibold text-ink">{label}</span>
                  <span className="line-clamp-2 text-[12px] leading-snug text-ink-3">{desc}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          shown.map((m) => (
            <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed", m.role === "user" ? "rounded-br-sm bg-brand text-on-brand" : "rounded-bl-sm border border-line bg-soft text-ink")}>
                {m.role === "user" && m.attachments?.length ? <div className="mb-1.5"><MessageAttachments attachments={m.attachments} /></div> : null}
                {m.role === "user" ? m.content && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.content}</p> : <Markdown content={m.content} agentId={companion.agentId} />}
                {m.role === "assistant" && !(isStreaming && m === shown[shown.length - 1]) && pagesIn(m.content, path).length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {pagesIn(m.content, path).map((p) => (
                      <Link key={p.href} href={p.href} onClick={leave} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-brand/25 bg-surface px-3 text-[13px] font-semibold text-brand-ink hover:bg-tint">
                        Ouvrir {p.label} <ArrowUpRight className="size-3.5" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        {isStreaming && (
          <p role="status" className="flex items-center gap-2 pl-1 text-[13px] text-ink-3">
            <Loader2 className="size-3.5 animate-spin text-brand" /> {thinking ? "Yélé réfléchit…" : "Yélé rédige sa réponse…"}
          </p>
        )}
        {error && <p role="alert" className="rounded-xl bg-ko-pale p-2.5 text-[13px] text-ko">{error}</p>}
      </div>

      {/* The same writing area as an Expert's chat: a field that grows with the text (Entrée sends,
          Maj + Entrée goes to the line), 16 px on a phone so iOS does not zoom, a 44 px send button. */}
      <form onSubmit={submit} className="border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3">
        {/* Once a discussion has started the shortcuts stay one tap away, in a row that scrolls. */}
        {shown.length > 0 && !past && (
          <div className="-mx-3 mb-2 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none]">
            {shortcuts.map(({ label, prompt, icon: Icon }) => (
              <button key={label} type="button" onClick={() => send(prompt)} disabled={isStreaming} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] font-semibold text-ink-2 hover:border-brand/30 hover:bg-soft disabled:opacity-50">
                <Icon className="size-3.5 text-brand" /> {label}
              </button>
            ))}
          </div>
        )}
        <div className="rounded-[18px] border border-line bg-soft/70 transition-colors focus-within:border-brand/40 focus-within:bg-surface focus-within:ring-2 focus-within:ring-brand/15">
          <div className="pt-2 empty:hidden [&>div]:px-2 [&>div]:pb-1">
            <AttachmentTray files={att.files} onRemove={att.removeFile} onRetry={att.retryFile} />
          </div>
          {dictating ? (
            <div className="pt-3 [&>div]:pb-1.5">
              <DictationBar dictation={dictation} />
            </div>
          ) : (
            <div className="flex items-end gap-1 p-1.5">
              <AttachButton onFiles={att.addFiles} />
              <textarea
                ref={fieldRef}
                value={input}
                rows={1}
                onChange={(e) => {
                  setInput(e.target.value);
                  grow(e.target);
                }}
                onPaste={att.handlePaste}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="Posez une question à Yélé…"
                aria-label="Votre question à Yélé"
                className="max-h-[132px] min-h-[44px] w-full resize-none bg-transparent px-1 py-2.5 text-base leading-6 text-ink outline-none placeholder:text-ink-3 sm:text-[15px]"
              />
              {/* ONE round button: the microphone while the message is empty, then Envoyer. */}
              {canDictate && !canSend && !isStreaming ? (
                <button
                  type="button"
                  onClick={() => void dictation.start()}
                  disabled={onCall}
                  aria-label={onCall ? "Pendant l’appel, écrivez au clavier" : "Dicter un message"}
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-brand text-on-brand hover:opacity-90 disabled:opacity-40"
                >
                  <Mic className="size-[18px]" />
                </button>
              ) : (
                <button type="submit" disabled={!canSend} aria-label="Envoyer" className="grid size-11 shrink-0 place-items-center rounded-full bg-brand text-on-brand hover:opacity-90 disabled:pointer-events-none disabled:opacity-40">
                  {att.uploading ? <Loader2 className="size-[18px] animate-spin" /> : <Send className="size-[18px]" />}
                </button>
              )}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
