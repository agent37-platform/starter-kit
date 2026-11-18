"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { isOpen, type ApprovalChoice, type ApprovalRequest } from "@/lib/approval";
import { cn } from "@/lib/utils";

const DONE: Record<ApprovalChoice, string> = {
  once: "Envoyé : l’Expert poursuit.",
  always: "Autorisé pour ce destinataire : l’Expert ne redemandera plus.",
  deny: "Annulé : l’Expert n’a rien envoyé.",
};

const button = "inline-flex min-h-11 items-center justify-center rounded-xl border px-3.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:opacity-50";

// An action the expert holds until the member says yes. The message is the model's text: rendered as text only.
export function ApprovalCard({
  approval,
  onAnswer,
  onModify,
  onRetry,
}: {
  approval: ApprovalRequest;
  onAnswer: (choice: ApprovalChoice) => void;
  onModify: () => void;
  /** Sends the same request again, once this one has expired. */
  onRetry?: () => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (approval.state !== "pending") return;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(0, approval.expiresAt - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [approval.state, approval.expiresAt]);
  const open = isOpen(approval);
  const sending = approval.state === "sending";
  const expired = approval.state === "expired" || (approval.state === "pending" && !open);

  return (
    <div role="group" aria-label="Accord demandé" className="my-3 rounded-2xl border border-brand/30 bg-tint p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-brand">
        <ShieldCheck className="h-4 w-4 shrink-0" /> Votre accord avant d’agir
      </p>
      <p className="mt-2 whitespace-pre-wrap text-[15px] text-ink [overflow-wrap:anywhere]">{approval.message}</p>
      {approval.auto && approval.state !== "pending" ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-2">
          {approval.state === "sending" && <Loader2 className="h-4 w-4 animate-spin" />}
          {approval.state === "expired" ? "Demande expirée : l’Expert n’a rien envoyé." : "Accord donné depuis Envoyer."}
        </p>
      ) : approval.state === "answered" ? (
        <p className="mt-3 text-sm text-ink-2">{DONE[approval.choice ?? "once"]}</p>
      ) : expired ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-ink-3">Demande expirée : l’Expert n’a rien envoyé.</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className={cn(button, "border-brand bg-brand text-on-brand hover:bg-brand/90")}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Redemander
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={sending} onClick={() => onAnswer("once")} className={cn(button, "border-brand bg-brand text-on-brand hover:bg-brand/90")}>
            {sending && approval.choice === "once" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Envoyer
          </button>
          {approval.choices.includes("always") && (
            <button type="button" disabled={sending} onClick={() => onAnswer("always")} className={cn(button, "border-line bg-surface text-ink hover:bg-soft")}>
              Toujours pour ce destinataire
            </button>
          )}
          <button type="button" disabled={sending} onClick={onModify} className={cn(button, "border-line bg-surface text-ink hover:bg-soft")}>
            Modifier
          </button>
          <button type="button" disabled={sending} onClick={() => onAnswer("deny")} className={cn(button, "border-transparent text-ink-2 hover:bg-soft")}>
            Annuler
          </button>
        </div>
      )}
    </div>
  );
}
