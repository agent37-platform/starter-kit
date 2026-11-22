"use client";

import { useEffect, useRef, useState } from "react";
import { Mail, MessageCircle, Send, Users, X } from "lucide-react";
import { SendDialog } from "@/components/experts/SendDialog";
import { useSendAccounts } from "@/components/experts/useSendAccounts";
import { recipientList, sendFilesText } from "@/lib/send-accounts";
import type { TurnDoc } from "@/lib/drive-links";
import { cn } from "@/lib/utils";

// « La prochaine action » (Kirane, Leslie 16/11): under the last reply that delivered a document, the Expert
// offers to send it. The person named in the request first (« c'est pour Moussa »), else the member;
// « À quelqu'un d'autre » opens the sending dialog. A click writes the instruction to the Expert, who sends
// with its own tools as for « Envoyer ». The cross closes the offer for this reply.
// Leslie, 19/11: one line of small pills under the reply, not a card of three big buttons, and « /envoi »
// in the composer brings the offer back for the conversation's last delivered document (`ENVOI_EVENT`).
const OFF_KEY = "yelema.next-action-off";
/** Sent by the composer on « /envoi »: the last reply that delivered a document shows its offer again. */
export const ENVOI_EVENT = "yelema:envoi";

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

const pill =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30";
const quiet = "border border-line bg-surface text-ink hover:bg-soft";

type Props = {
  /** The reply's id: the cross is kept for it. */
  id: string;
  agentId: string;
  profile: string | null;
  docs: TurnDoc[];
  expertName: string | null;
  /** The person named in the request, if any. */
  person: string | null;
  onSend: (text: string) => void;
  /** Offered unasked (the conversation's last reply); otherwise only « /envoi » shows it. */
  offer: boolean;
};

export function NextAction(props: Props) {
  const { id, docs, offer } = props;
  const [closed, setClosed] = useState(() => closedFor(id));
  const [asked, setAsked] = useState(false);
  const mark = useRef<HTMLSpanElement | HTMLDivElement | null>(null);

  // « /envoi »: only the last reply on the page that delivered something answers.
  useEffect(() => {
    const on = () => {
      const all = document.querySelectorAll("[data-next-action]");
      if (all[all.length - 1]?.getAttribute("data-next-action") !== id) return;
      setAsked(true);
      setClosed(false);
      requestAnimationFrame(() => mark.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    };
    window.addEventListener(ENVOI_EVENT, on);
    return () => window.removeEventListener(ENVOI_EVENT, on);
  }, [id]);

  if (!docs.length) return null;
  if ((closed || !offer) && !asked) return <span ref={mark} data-next-action={id} hidden />;
  return (
    <div ref={mark as React.RefObject<HTMLDivElement>} data-next-action={id}>
      <Offer
        {...props}
        onClose={() => {
          closeFor(id);
          setClosed(true);
          setAsked(false);
        }}
      />
    </div>
  );
}

function Offer({ agentId, profile, docs, expertName, person, onSend, onClose }: Props & { onClose: () => void }) {
  const [other, setOther] = useState<boolean | "whatsapp">(false);
  const { accounts, myEmail } = useSendAccounts(agentId, profile);
  // A one-click sending takes the first e-mail account really plugged in; WhatsApp only when it is.
  const mail = accounts.find((a) => a.channel === "mail") ?? null;
  const whatsapp = accounts.find((a) => a.channel === "whatsapp") ?? null;
  const many = docs.length > 1;
  const first = person?.split(" ")[0] ?? null;
  const question = person ? (many ? `Je les envoie à ${first} ?` : `Je l’envoie à ${first} ?`) : many ? "Je vous les envoie ?" : "Je vous l’envoie ?";
  const send = (to: string[]) => (mail ? onSend(sendFilesText(docs, to, mail)) : setOther(true));
  const toMe = recipientList(true, myEmail, "", "mail");

  return (
    <div role="group" aria-label={many ? "Envoyer les livrables" : "Envoyer le livrable"} className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[13.5px] text-ink-2">{question}</span>
      {!mail ? (
        // No e-mail account plugged in: nothing is promised by e-mail; the dialog shows what is plugged in.
        <button type="button" onClick={() => setOther(true)} className={cn(pill, "bg-brand text-white hover:bg-brand/90")}>
          <Send className="size-3.5" />
          Envoyer
        </button>
      ) : (
        <>
          {person && (
            <button type="button" onClick={() => send([person])} className={cn(pill, "bg-brand text-white hover:bg-brand/90")}>
              <Send className="size-3.5" />À {first}
            </button>
          )}
          <button type="button" onClick={() => send(toMe)} className={cn(pill, person ? quiet : "bg-brand text-white hover:bg-brand/90")}>
            <Mail className="size-3.5" />À moi
          </button>
          {whatsapp && (
            <button type="button" onClick={() => setOther("whatsapp")} aria-label="Par WhatsApp" title="Par WhatsApp" className={cn(pill, quiet, "w-8 px-0")}>
              <MessageCircle className="size-3.5" />
            </button>
          )}
          <button type="button" onClick={() => setOther(true)} className={cn(pill, quiet)}>
            <Users className="size-3.5" />À quelqu’un d’autre
          </button>
        </>
      )}
      <button type="button" onClick={onClose} aria-label="Pas maintenant" title="Pas maintenant" className={cn(pill, "w-8 px-0 text-ink-3 hover:bg-soft hover:text-ink")}>
        <X className="size-3.5" />
      </button>
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
