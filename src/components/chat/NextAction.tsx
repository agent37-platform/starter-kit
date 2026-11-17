"use client";

import { useState } from "react";
import { Mail, MessageCircle, Send, Users } from "lucide-react";
import { SendDialog } from "@/components/experts/SendDialog";
import { useSendAccounts } from "@/components/experts/useSendAccounts";
import { recipientList, sendFilesText } from "@/lib/send-accounts";
import type { TurnDoc } from "@/lib/drive-links";
import { cn } from "@/lib/utils";

// « La prochaine action » (Kirane, Leslie 16/11): under the last reply that delivered a document, the Expert
// offers to send it. The person named in the request first (« c'est pour Moussa »), else the member;
// « À quelqu'un d'autre » opens the sending dialog. A click writes the instruction to the Expert, who sends
// with its own tools as for « Envoyer ». « Pas maintenant » closes the offer for this reply.
const OFF_KEY = "yelema.next-action-off";

function closedFor(id: string): boolean {
  try {
    return (localStorage.getItem(OFF_KEY) ?? "").split(" ").includes(id);
  } catch {
    return false;
  }
}

function closeFor(id: string): void {
  try {
    const kept = (localStorage.getItem(OFF_KEY) ?? "").split(" ").filter(Boolean).slice(-50);
    localStorage.setItem(OFF_KEY, [...kept, id].join(" "));
  } catch {
    // Private window: closed for this page only.
  }
}

const button = "inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30";

export function NextAction({
  id,
  agentId,
  profile,
  docs,
  expertName,
  person,
  onSend,
}: {
  /** The reply's id: « Pas maintenant » is kept for it. */
  id: string;
  agentId: string;
  profile: string | null;
  docs: TurnDoc[];
  expertName: string | null;
  /** The person named in the request, if any. */
  person: string | null;
  onSend: (text: string) => void;
}) {
  const [closed, setClosed] = useState(() => closedFor(id));
  const [other, setOther] = useState<boolean | "whatsapp">(false);
  const { accounts, myEmail } = useSendAccounts(agentId, profile);
  if (closed || !docs.length) return null;
  // A one-click sending takes the first e-mail account really plugged in; WhatsApp only when it is.
  const mail = accounts.find((a) => a.channel === "mail") ?? null;
  const whatsapp = accounts.find((a) => a.channel === "whatsapp") ?? null;
  const what = docs.length === 1 ? "Le livrable est prêt." : `Les ${docs.length} livrables sont prêts.`;
  const first = person?.split(" ")[0] ?? null;
  const send = (to: string[]) => (mail ? onSend(sendFilesText(docs, to, mail)) : setOther(true));
  const toMe = recipientList(true, myEmail, "", "mail");

  return (
    <div role="group" aria-label="Envoyer le livrable" className="mt-3 max-w-md rounded-2xl border border-brand/30 bg-tint/60 p-3.5">
      <p className="text-[14.5px] text-ink">
        {what} {person ? <>Je l’envoie à <b>{person}</b> ?</> : "Je vous l’envoie ?"}
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {!mail ? (
          // No e-mail account plugged in: nothing is promised by e-mail; the dialog shows what is plugged in.
          <button type="button" onClick={() => setOther(true)} className={cn(button, "bg-brand text-white hover:bg-brand/90")}>
            <Send className="size-4" />
            Envoyer
          </button>
        ) : person ? (
          <>
            <button type="button" onClick={() => send([person])} className={cn(button, "bg-brand text-white hover:bg-brand/90")}>
              <Send className="size-4" />À {first}, par e-mail
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={() => send(toMe)} className={cn(button, "shrink-0 whitespace-nowrap border border-line bg-surface text-ink hover:bg-soft")}>
                <Mail className="size-4" />À moi
              </button>
              <button type="button" onClick={() => setOther(true)} className={cn(button, "min-w-0 flex-1 whitespace-nowrap border border-line bg-surface px-3 text-ink hover:bg-soft")}>
                <Users className="size-4" />À quelqu’un d’autre
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex gap-2">
              <button type="button" onClick={() => send(toMe)} className={cn(button, "flex-1 bg-brand text-white hover:bg-brand/90")}>
                <Mail className="size-4" />À moi, par e-mail
              </button>
              {whatsapp && (
                <button
                  type="button"
                  onClick={() => setOther("whatsapp")}
                  aria-label="Par WhatsApp"
                  title="Par WhatsApp"
                  className={cn(button, "w-11 border border-line bg-surface px-0 text-ink hover:bg-soft")}
                >
                  <MessageCircle className="size-4" />
                </button>
              )}
            </div>
            <button type="button" onClick={() => setOther(true)} className={cn(button, "border border-line bg-surface text-ink hover:bg-soft")}>
              <Users className="size-4" />À quelqu’un d’autre
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => {
            closeFor(id);
            setClosed(true);
          }}
          className={cn(button, "h-10 bg-soft text-[13.5px] text-ink-2 hover:text-ink")}
        >
          Pas maintenant
        </button>
      </div>
      {other && (
        <SendDialog
          mode="file"
          agentId={agentId}
          profileId={profile}
          expertName={expertName ?? "L’Expert"}
          files={docs}
          prefer={other === "whatsapp" ? "whatsapp" : "mail"}
          toMe={false}
          onSend={(text) => {
            setOther(false);
            onSend(text);
          }}
          onClose={() => setOther(false)}
        />
      )}
    </div>
  );
}
