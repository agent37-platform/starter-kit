"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Paperclip, RotateCcw, ShieldCheck } from "lucide-react";
import { isOpen, type ApprovalChoice, type ApprovalRequest } from "@/lib/approval";
import { mailPreview } from "@/lib/mail-preview";
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
  const mail = mailPreview(approval.message);
  const sending = approval.state === "sending";
  const expired = approval.state === "expired" || (approval.state === "pending" && !open);

  return (
    <div role="group" aria-label="Accord demandé" className="my-3 rounded-2xl border border-brand/30 bg-tint p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-brand">
        <ShieldCheck className="h-4 w-4 shrink-0" /> Votre accord avant d’agir
      </p>
      {mail ? (
        // The e-mail as it will leave (Leslie, 19/11), so the member checks it before saying yes.
        <div className="mt-3 overflow-hidden rounded-xl border border-line bg-surface text-[14px]">
          {mail.doubts && (
            <p className="flex items-start gap-2 border-b border-line bg-amber-50 px-3.5 py-2 text-[13px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />À vérifier : {mail.doubts}
            </p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-b border-line px-3.5 py-2.5 [overflow-wrap:anywhere]">
            <dt className="text-ink-3">À</dt>
            <dd className="text-ink">{mail.to.join(", ")}</dd>
            {mail.cc.length > 0 && (
              <>
                <dt className="text-ink-3">Cc</dt>
                <dd className="text-ink">{mail.cc.join(", ")}</dd>
              </>
            )}
            {mail.subject && (
              <>
                <dt className="text-ink-3">Objet</dt>
                <dd className="font-semibold text-ink">{mail.subject}</dd>
              </>
            )}
          </dl>
          {mail.body && <p className="max-h-72 overflow-y-auto whitespace-pre-wrap px-3.5 py-3 leading-relaxed text-ink [overflow-wrap:anywhere]">{mail.body}</p>}
          {mail.attachments.length > 0 && (
            <ul aria-label="Pièces jointes" className="flex flex-wrap gap-1.5 border-t border-line px-3.5 py-2.5">
              {mail.attachments.map((a) => (
                <li key={a} className="inline-flex items-center gap-1.5 rounded-full bg-soft px-2.5 py-1 text-[12.5px] text-ink-2">
                  <Paperclip className="size-3" />
                  {a}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-[15px] text-ink [overflow-wrap:anywhere]">{approval.message}</p>
      )}
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
