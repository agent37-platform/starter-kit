"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownRight, Loader2, MessagesSquare } from "lucide-react";
import { shortName, startsRun, type BuzzEntry } from "@/lib/buzz";
import type { Conversation, Message } from "@/lib/buzz-relay";
import { cn } from "@/lib/utils";
import type { Candidate } from "@/lib/buzz-mentions";
import { Markdown } from "@/components/chat/Markdown";
import { ReplyChoices } from "@/components/chat/ReplyActions";
import { replyParts } from "@/lib/reply-parts";
import { MentionComposer } from "@/components/messaging/MentionComposer";
import { ParticipantAvatar } from "@/components/messaging/ParticipantAvatar";
import { SalonDeliverables } from "@/components/messaging/SalonDeliverables";
import { SalonParticipants } from "@/components/messaging/SalonParticipants";

// Le fil d'un échange, comme le chat d'un Expert (l'en-tête et ses onglets sont dans ExchangeHeader) : messages,
// visage de l'auteur en tête de chaque suite, choix du dernier message en boutons (comme le chat d'un Expert), « … travaille » pour vos Experts sollicités, saisie avec « @ ».

const moment = (seconds: number) => new Date(seconds * 1000).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export interface ThreadProps {
  current: Conversation | null;
  salon: boolean;
  pane: "fil" | "livrables" | "participants";
  thread: Message[] | null;
  mine: string[];
  labels: Map<string, string>;
  directory: BuzzEntry[];
  failed: boolean;
  onRetry: () => void;
  busy: BuzzEntry[];
  candidates: Candidate[];
  sending: boolean;
  onSend: (text: string, mentions: string[], replyTo: string | null) => Promise<boolean>;
}

export function ExchangeThread(p: ThreadProps) {
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const end = useRef<HTMLLIElement>(null);
  const id = p.current?.id;
  const byKey = useMemo(() => new Map(p.directory.flatMap((e) => e.cles.map((k): [string, BuzzEntry] => [k, e]))), [p.directory]);

  useEffect(() => {
    setReplyTo(null);
  }, [id]);
  // Bloc, pas expression : scrollIntoView renvoie désormais une promesse, que React prendrait pour un nettoyage.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [p.thread?.length, p.busy.length]);

  if (!p.current)
    return (
      <div className="m-auto p-10 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-soft text-ink-3"><MessagesSquare className="h-6 w-6" /></span>
        <h2 className="mt-3 text-base font-semibold text-ink">Choisissez un échange</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-3">« Message » écrit à une personne ou à ses Experts ; « Salon » ouvre un espace nommé à plusieurs, où vos Experts travaillent quand vous les mentionnez avec « @ ».</p>
      </div>
    );

  const nameOf = (k: string) => (p.mine.includes(k) ? "Vous" : (p.labels.get(k) ?? "Membre inconnu"));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {p.pane === "livrables" && p.salon ? (
        <SalonDeliverables salon={p.current.id} />
      ) : p.pane === "participants" && p.salon ? (
        <SalonParticipants members={p.current.members} directory={p.directory} mine={p.mine} />
      ) : (
        <>
          <ol className="min-h-0 flex-1 overflow-y-auto px-5 py-4" aria-busy={p.thread === null}>
            {p.thread === null && !p.failed && <li className="flex items-center gap-2 text-sm text-ink-3"><Loader2 className="h-4 w-4 animate-spin" />Chargement…</li>}
            {p.thread === null && p.failed && (
              <li className="flex flex-wrap items-center gap-2 text-sm text-ink-3" role="status">
                Le fil n’a pas pu être chargé : la connexion au relais se rétablit.
                <button type="button" onClick={p.onRetry} className="rounded-md px-2 py-0.5 text-xs font-semibold text-brand-ink hover:bg-soft">Réessayer</button>
              </li>
            )}
            {p.thread?.length === 0 && <li className="text-sm text-ink-3">Aucun message pour l’instant.</li>}
            {p.thread?.map((m, i) => {
              const own = p.mine.includes(m.author);
              // Seul le dernier message, d'un autre, se répond en un clic ; un choix plus ancien reste écrit.
              const parts = !own && i === (p.thread?.length ?? 0) - 1 ? replyParts(m.text) : null;
              const choices = parts?.choices.length ? parts : null;
              const first = startsRun(p.thread?.[i - 1], m) || Boolean(m.replyTo);
              return (
                <li key={m.id} className={cn("group flex gap-2.5", own && "flex-row-reverse", first ? "mt-4 first:mt-0" : "mt-1", m.replyTo && "pl-8")}>
                  {!own && (first ? <ParticipantAvatar entry={byKey.get(m.author) ?? null} name={nameOf(m.author)} className="mt-0.5" /> : <span className="w-7 shrink-0" aria-hidden />)}
                  <div className={cn("flex min-w-0 flex-1 flex-col", own ? "items-end" : "items-start")}>
                    {first && (
                      <div className={cn("flex items-baseline gap-2", own && "flex-row-reverse")}>
                        {m.replyTo && <CornerDownRight className="h-3.5 w-3.5 shrink-0 self-center text-ink-3" />}
                        <span className="text-[13px] font-semibold text-ink">{nameOf(m.author)}</span>
                        <time className="text-[11.5px] text-ink-3">{moment(m.at)}</time>
                      </div>
                    )}
                    <div className={cn("flex max-w-full items-center gap-1.5", own && "flex-row-reverse", first && "mt-1")}>
                      <div className={cn("min-w-0 max-w-[min(680px,90%)] break-words rounded-2xl px-3.5 py-2.5 text-ink", own ? "rounded-tr-md bg-tint" : "rounded-tl-md border border-line bg-surface")} title={first ? undefined : moment(m.at)}>
                        {/* Comme le chat d'un Expert : liens cliquables (un site extérieur demande confirmation), listes, gras. */}
                        <Markdown content={choices ? choices.body : m.text} />
                      </div>
                      <button type="button" onClick={() => setReplyTo(m)} className="shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold text-ink-2 opacity-0 hover:bg-soft focus-visible:opacity-100 group-hover:opacity-100">
                        Répondre
                      </button>
                    </div>
                    {choices && (
                      <ReplyChoices
                        choices={choices.choices}
                        note={choices.choicesNote}
                        onSend={(text) => !p.sending && void p.onSend(text, p.candidates.some((c) => c.mine && c.entry.cles.includes(m.author)) ? [m.author] : [], m.id)}
                      />
                    )}
                  </div>
                </li>
              );
            })}
            {p.busy.map((e) => (
              <li key={`busy-${e.nom}`} className="mt-4 flex items-center gap-2.5 text-sm text-ink-3" role="status">
                <ParticipantAvatar entry={e} name={e.nom} /> <Loader2 className="h-4 w-4 animate-spin" /> {shortName(e.nom)} travaille…
              </li>
            ))}
            <li ref={end} aria-hidden />
          </ol>
          <MentionComposer
            candidates={p.candidates}
            replyTo={replyTo ? `Réponse à ${nameOf(replyTo.author)} : « ${replyTo.text} »` : null}
            onCancelReply={() => setReplyTo(null)}
            sending={p.sending}
            onSend={async (text, mentions) => {
              const ok = await p.onSend(text, mentions, replyTo?.id ?? null);
              if (ok) setReplyTo(null);
              return ok;
            }}
          />
        </>
      )}
    </div>
  );
}
