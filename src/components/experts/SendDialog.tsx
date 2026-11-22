"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, FileCheck, FileText, CalendarCheck, Linkedin, Loader2, Mail, MessageCircle, Plug, Send } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DOC_TONE } from "@/components/files/preview-siblings";
import { docKind } from "@/lib/drive-links";
import { recipientList, sendFilesText, sendRoutineText, type SendChannel } from "@/lib/send-accounts";
import { useSendAccounts } from "./useSendAccounts";
import { cn } from "@/lib/utils";

// « Envoyer » on a deliverable, and « Envoi automatique » among the routines (Leslie, 16/11 and 17/11). The
// dialog offers only the accounts really plugged in for this expert (`useSendAccounts`), the files one by
// one, and the member's own address for « Moi-même ». It writes the instruction (account, exact paths, a
// proof asked back), which lands in the expert's chat; the expert sends with its own tools.

type What = "each" | "minutes";

const WHATS: { id: What; label: string; hint: string; icon: typeof Mail }[] = [
  { id: "each", label: "Chaque livrable", hint: "Dès qu’il est prêt", icon: FileCheck },
  { id: "minutes", label: "Le compte rendu d’un rendez-vous", hint: "Après chaque rendez-vous de l’agenda", icon: CalendarCheck },
];

const CHANNEL_ICON: Record<SendChannel, typeof Mail> = { mail: Mail, whatsapp: MessageCircle, linkedin: Linkedin };

export interface SendFile {
  name: string;
  path: string;
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-full border px-3.5 text-[13.5px] font-medium",
        on ? "border-brand bg-tint text-brand-ink" : "border-line bg-surface text-ink hover:bg-soft",
      )}
    >
      {children}
    </button>
  );
}

const label = "mb-2 mt-4 block text-[12.5px] font-semibold text-ink-3";

export function SendDialog({
  mode,
  agentId,
  profileId,
  expertName,
  files = [],
  prefer = "mail",
  toMe = true,
  onSend,
  onClose,
}: {
  /** "file": deliverables now; "routine": an automatic sending. */
  mode: "file" | "routine";
  agentId: string;
  profileId: string | null;
  expertName: string;
  /** The deliverables offered, all ticked at first. */
  files?: SendFile[];
  /** The channel picked first when an account of it is plugged in. */
  prefer?: SendChannel;
  /** « Moi-même » ticked at first (« À quelqu'un d'autre » opens it unticked). */
  toMe?: boolean;
  /** The instruction, handed to the expert's chat. */
  onSend: (text: string) => void;
  onClose: () => void;
}) {
  const { accounts, loaded, myEmail } = useSendAccounts(agentId, profileId);
  const [what, setWhat] = useState<What>("each");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(files.map((f) => f.path)));
  const [me, setMe] = useState(toMe);
  const [others, setOthers] = useState("");
  // Cc and Cci, as in Gmail: behind one link until asked for (Leslie, 20/11).
  const [copies, setCopies] = useState(false);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ask, setAsk] = useState(true);
  const account = accounts.find((a) => a.id === accountId) ?? accounts.find((a) => a.channel === prefer) ?? accounts[0] ?? null;
  const channel = account?.channel ?? "mail";
  const to = recipientList(me, myEmail, others, channel);
  const chosen = files.filter((f) => picked.has(f.path));
  const split = (v: string) => recipientList(false, null, v, "mail");
  const ready = Boolean(account) && to.length > 0 && (mode === "routine" || chosen.length > 0);
  const toggle = (path: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "file" ? "Envoyer" : "Envoi automatique"}</DialogTitle>
          <DialogDescription>
            {mode === "file"
              ? files.length > 1
                ? `${chosen.length} livrable${chosen.length > 1 ? "s" : ""} sur ${files.length}`
                : (files[0]?.name ?? "")
              : `${expertName} envoie pour vous, à chaque fois.`}
          </DialogDescription>
        </DialogHeader>

        {mode === "routine" && (
          <>
            <span className={cn(label, "mt-0")}>Quoi</span>
            <div className="grid gap-2">
              {WHATS.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  aria-pressed={what === w.id}
                  onClick={() => setWhat(w.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left",
                    what === w.id ? "border-brand bg-tint/60" : "border-line bg-card hover:bg-soft",
                  )}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface text-brand-ink">
                    <w.icon className="size-[17px]" />
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block text-[14px] font-semibold text-ink">{w.label}</span>
                    <span className="mt-0.5 block text-[12.5px] text-ink-3">{w.hint}</span>
                  </span>
                  {what === w.id && <Check className="size-4 shrink-0 text-brand" />}
                </button>
              ))}
            </div>
          </>
        )}

        {mode === "file" && files.length > 1 && (
          <>
            <span className={cn(label, "mt-0 flex items-center justify-between")}>
              Quoi
              <button
                type="button"
                onClick={() => setPicked(chosen.length === files.length ? new Set() : new Set(files.map((f) => f.path)))}
                className="text-[12.5px] font-semibold text-brand-ink hover:underline"
              >
                {chosen.length === files.length ? "Tout décocher" : "Tout cocher"}
              </button>
            </span>
            <ul className="max-h-[18.5rem] overflow-y-auto rounded-2xl border border-line">
              {files.map((f) => {
                const kind = docKind(f.name);
                const on = picked.has(f.path);
                return (
                  <li key={f.path} className="border-t border-line first:border-t-0">
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-soft">
                      <input type="checkbox" checked={on} onChange={() => toggle(f.path)} className="size-[18px] shrink-0 accent-[var(--brand)]" />
                      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg text-white", kind === "other" ? "bg-tint text-brand-ink" : DOC_TONE[kind])}>
                        <FileText className="size-4" />
                      </span>
                      <span className={cn("line-clamp-2 min-w-0 flex-1 break-all text-[13.5px] leading-snug", on ? "text-ink" : "text-ink-3")} title={f.name}>
                        {f.name}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <span className={cn(label, "flex items-center justify-between", mode === "file" && files.length <= 1 && "mt-0")}>
          À qui
          {channel === "mail" && mode === "file" && !copies && (
            <button type="button" onClick={() => setCopies(true)} className="text-[12.5px] font-semibold text-brand-ink hover:underline">
              Cc Cci
            </button>
          )}
        </span>
        {channel === "mail" && (
          <div className="flex flex-wrap items-center gap-2">
            <Chip on={me} onClick={() => setMe(!me)}>
              {me && <Check className="size-4" />}
              Moi-même
            </Chip>
            {me && myEmail && <span className="min-w-0 truncate text-[12.5px] text-ink-3">{myEmail}</span>}
          </div>
        )}
        <Input
          className={cn(channel === "mail" && "mt-2")}
          value={others}
          onChange={(e) => setOthers(e.target.value)}
          placeholder={channel === "mail" ? "Autres personnes : nom ou e-mail" : channel === "whatsapp" ? "Nom ou numéro" : "Nom de la personne sur LinkedIn"}
          aria-label="Autres personnes"
        />
        {channel === "mail" && mode === "file" && copies && (
          <div className="mt-2 grid gap-2">
            {([["Cc", "Copie (Cc)", cc, setCc], ["Cci", "Copie cachée (Cci)", bcc, setBcc]] as const).map(([word, name, value, set]) => (
              <label key={word} className="relative block">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-ink-3">{word}</span>
                <Input className="pl-12" value={value} onChange={(e) => set(e.target.value)} placeholder="Nom ou e-mail" aria-label={name} />
              </label>
            ))}
          </div>
        )}

        <span className={label}>Envoyé depuis</span>
        {!loaded && !accounts.length ? (
          <p className="flex h-11 items-center gap-2 text-[13px] text-ink-3">
            <Loader2 className="size-4 animate-spin" />
            Lecture de vos comptes…
          </p>
        ) : !accounts.length ? (
          <div className="rounded-2xl bg-soft p-3.5 text-[13.5px] text-ink-2">
            Aucun compte d’envoi n’est branché pour {expertName}.
            <Link href="/integrations/connecteurs" className="mt-2 flex items-center gap-1.5 font-semibold text-brand-ink hover:underline">
              <Plug className="size-4" />
              Brancher un compte d’envoi
            </Link>
          </div>
        ) : (
          <div role="radiogroup" aria-label="Envoyé depuis" className="overflow-hidden rounded-2xl border border-line">
            {accounts.map((a) => {
              const Icon = CHANNEL_ICON[a.channel];
              const on = account?.id === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setAccountId(a.id)}
                  className={cn("flex min-h-12 w-full items-center gap-3 border-t border-line px-3 py-2 text-left first:border-t-0", on ? "bg-tint/60" : "hover:bg-soft")}
                >
                  <span className={cn("grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px]", on ? "border-brand" : "border-ink-3/40")}>
                    {on && <span className="size-2 rounded-full bg-brand" />}
                  </span>
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface text-brand-ink ring-1 ring-line">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block text-[13.5px] font-semibold text-ink">{a.title}</span>
                    {a.detail && <span className="mt-0.5 block truncate text-[12px] text-ink-3">{a.detail}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {mode === "routine" && (
          <>
            <span className={label}>{expertName}</span>
            <div className="flex rounded-xl bg-soft p-1">
              {[
                { on: true, text: "Me demande avant" },
                { on: false, text: "Envoie sans demander" },
              ].map((o) => (
                <button
                  key={o.text}
                  type="button"
                  aria-pressed={ask === o.on}
                  onClick={() => setAsk(o.on)}
                  className={cn("h-9 flex-1 rounded-[10px] text-[13px] font-semibold", ask === o.on ? "bg-card text-ink shadow-sm" : "text-ink-2")}
                >
                  {o.text}
                </button>
              ))}
            </div>
          </>
        )}

        <Button
          className="mt-5 w-full"
          disabled={!ready}
          onClick={() => account && onSend(mode === "file" ? sendFilesText(chosen, to, account, { cc: split(cc), bcc: split(bcc) }) : sendRoutineText(what, to, account, ask))}
        >
          <Send className="h-4 w-4" />
          {mode === "file" ? "Préparer l’envoi" : "Continuer dans le chat"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
