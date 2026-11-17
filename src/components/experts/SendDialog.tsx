"use client";

import { useState } from "react";
import { Check, FileCheck, CalendarCheck, Linkedin, Mail, MessageCircle, Send } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// « Envoyer » on a deliverable, and « Envoi automatique » among the routines (Leslie, 16/11). Nothing new
// on the back office: the expert already sends mail and messages with its own tools, asking first when it
// must. The dialog only writes the instruction, which lands in the expert's chat field for the member to send.

type Channel = "mail" | "whatsapp" | "linkedin";
type What = "each" | "minutes";

const CHANNELS: { id: Channel; label: string; words: string; icon: typeof Mail }[] = [
  { id: "mail", label: "E-mail", words: "par e-mail", icon: Mail },
  { id: "whatsapp", label: "WhatsApp", words: "par WhatsApp", icon: MessageCircle },
  { id: "linkedin", label: "LinkedIn", words: "par LinkedIn", icon: Linkedin },
];

const WHATS: { id: What; label: string; hint: string; icon: typeof Mail }[] = [
  { id: "each", label: "Chaque livrable", hint: "Dès qu’il est prêt", icon: FileCheck },
  { id: "minutes", label: "Le compte rendu d’un rendez-vous", hint: "Après chaque rendez-vous de l’agenda", icon: CalendarCheck },
];

function recipients(me: boolean, others: string): string {
  const list = [...(me ? ["moi-même"] : []), ...(others.trim() ? [others.trim()] : [])];
  return list.join(" et ");
}

/** The instruction for one file sent now. */
export function sendFileText(name: string, to: string, channel: Channel): string {
  return `Envoie « ${name} » à ${to} ${CHANNELS.find((c) => c.id === channel)!.words}.`;
}

/** The standing instruction of an automatic sending. */
export function sendRoutineText(what: What, to: string, channel: Channel, ask: boolean): string {
  const words = CHANNELS.find((c) => c.id === channel)!.words;
  const head =
    what === "each"
      ? `Nouvelle routine d’envoi : dès qu’un livrable est prêt, envoie-le à ${to} ${words}.`
      : `Nouvelle routine d’envoi : après chaque rendez-vous, envoie le compte rendu à ${to} ${words}.`;
  return `${head} ${ask ? "Demande-moi avant chaque envoi." : "Envoie sans me demander."} Garde cette consigne jusqu’à ce que je te dise d’arrêter.`;
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
  expertName,
  fileName,
  toMe = true,
  onSend,
  onClose,
}: {
  /** "file": one deliverable now; "routine": an automatic sending. */
  mode: "file" | "routine";
  expertName: string;
  fileName?: string;
  /** « Moi-même » ticked at first (« À quelqu'un d'autre » opens it unticked). */
  toMe?: boolean;
  /** The instruction, handed to the expert's chat. */
  onSend: (text: string) => void;
  onClose: () => void;
}) {
  const [what, setWhat] = useState<What>("each");
  const [me, setMe] = useState(toMe);
  const [others, setOthers] = useState("");
  const [channel, setChannel] = useState<Channel>("mail");
  const [ask, setAsk] = useState(true);
  const to = recipients(me, others);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "file" ? "Envoyer" : "Envoi automatique"}</DialogTitle>
          <DialogDescription>
            {mode === "file" ? (fileName ?? "") : `${expertName} envoie pour vous, à chaque fois.`}
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

        <span className={cn(label, mode === "file" && "mt-0")}>À qui</span>
        <div className="flex flex-wrap gap-2">
          <Chip on={me} onClick={() => setMe(!me)}>
            {me && <Check className="size-4" />}
            Moi-même
          </Chip>
        </div>
        <Input
          className="mt-2"
          value={others}
          onChange={(e) => setOthers(e.target.value)}
          placeholder="Autres personnes : nom, e-mail ou numéro"
          aria-label="Autres personnes"
        />

        <span className={label}>Par</span>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((c) => (
            <Chip key={c.id} on={channel === c.id} onClick={() => setChannel(c.id)}>
              <c.icon className="size-4" />
              {c.label}
            </Chip>
          ))}
        </div>

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
          disabled={!to}
          onClick={() => onSend(mode === "file" ? sendFileText(fileName ?? "ce fichier", to, channel) : sendRoutineText(what, to, channel, ask))}
        >
          <Send className="h-4 w-4" />
          {mode === "file" ? "Préparer l’envoi" : "Continuer dans le chat"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
