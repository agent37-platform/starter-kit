"use client";

import { Clock, Send, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type RoutineKind = "schedule" | "send" | "event";

const KINDS: { kind: RoutineKind; label: string; hint: string; icon: typeof Clock }[] = [
  { kind: "schedule", label: "À une heure", hint: "Chaque jour, chaque semaine, ou une seule fois.", icon: Clock },
  { kind: "send", label: "Envoi automatique", hint: "M’envoyer chaque livrable, le compte rendu après un rendez-vous.", icon: Send },
  { kind: "event", label: "Quand un événement arrive", hint: "Un mail, un message, un rendez-vous, un autre logiciel.", icon: Zap },
];

// « Nouvelle routine » : le premier choix, l'heure, un envoi automatique ou l'événement.
export function RoutineKindDialog({ expertName, onPick, onClose }: { expertName: string; onPick: (kind: RoutineKind) => void; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{expertName}, nouvelle routine</DialogTitle>
          <DialogDescription>Choisissez ce qui la lance.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              onClick={() => onPick(k.kind)}
              className="flex items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3.5 text-left hover:border-brand/30 hover:bg-tint/40"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-tint text-brand-ink">
                <k.icon className="size-[17px]" />
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block text-[14.5px] font-semibold text-ink">{k.label}</span>
                <span className="mt-0.5 block text-[12.5px] text-ink-3">{k.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
