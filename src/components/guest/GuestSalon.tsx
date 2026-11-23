"use client";

import { errorText } from "@/lib/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Hash, LogOut } from "lucide-react";
import { toast } from "sonner";
import { labelsOf, type BuzzEntry } from "@/lib/buzz";
import type { Conversation, Message } from "@/lib/buzz-relay";
import type { GuestView } from "@/lib/guest-access";
import { reconnectDelay } from "@/lib/instance-events";
import type { SalonDeliverable } from "@/lib/salon-deliverables";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ExchangeThread } from "@/components/messaging/ExchangeThread";
import type { ExchangePane } from "@/components/messaging/ExchangeHeader";

// Le salon tel qu'un invité le voit : le fil, les livrables et les participants, tous par les routes /invite.
// Le navigateur ne parle jamais au relais : le serveur lit, filtre et signe pour l'invité.

const TABS: { id: ExchangePane; label: string }[] = [
  { id: "fil", label: "Discussion" },
  { id: "livrables", label: "Livrables" },
  { id: "participants", label: "Participants" },
];
// The back office signs each file for about 15 minutes: read again before.
const URL_FRESH_MS = 10 * 60_000;
// Le serveur envoie un ping toutes les 9 s : au-delà, le flux est rouvert.
const SILENCE_MS = 25_000;
const sorted = (list: Message[]): Message[] => [...new Map(list.map((m) => [m.id, m])).values()].sort((a, b) => a.at - b.at || Number(a.replyTo !== null) - Number(b.replyTo !== null));
const withMessage = (t: Message[] | null, m: Message): Message[] => (t?.some((x) => x.id === m.id) ? t : [...(t ?? []), m]);

type Refusal = "ended" | "signed_out" | null;
const refusalOf = (status: number): Refusal => (status === 410 ? "ended" : status === 401 ? "signed_out" : null);

async function read<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; refusal: Refusal; message: string }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data: data as T };
    return { ok: false, refusal: refusalOf(res.status), message: (data as { error?: { message?: string } }).error?.message ?? "Le service est momentanément indisponible." };
  } catch {
    return { ok: false, refusal: null, message: "Le service est momentanément indisponible." };
  }
}

export function GuestSalon({ view, onEnded, onSignedOut }: { view: GuestView; onEnded: () => void; onSignedOut: () => void }) {
  const [pane, setPane] = useState<ExchangePane>("fil");
  const [directory, setDirectory] = useState<BuzzEntry[]>([]);
  const [thread, setThread] = useState<Message[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [link, setLink] = useState(0);
  const channel = view.salon.channel;

  // The page's callbacks change with each of its renders; the readings below must not start again for that.
  const leave = useRef({ onEnded, onSignedOut });
  leave.current = { onEnded, onSignedOut };
  const refused = useCallback((r: Refusal) => (r === "ended" ? leave.current.onEnded() : r === "signed_out" ? leave.current.onSignedOut() : undefined), []);

  const loadPeople = useCallback(async () => {
    const r = await read<{ directory: BuzzEntry[] }>("/invite/salon/participants");
    if (r.ok) setDirectory(r.data.directory);
    else refused(r.refusal);
  }, [refused]);

  useEffect(() => {
    void loadPeople();
  }, [loadPeople]);

  // Les livrables : lus à l'ouverture, puis avant que leurs liens signés n'expirent, et sur demande.
  const [items, setItems] = useState<SalonDeliverable[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [round, setRound] = useState(0);
  const refreshFiles = useCallback(() => setRound((r) => r + 1), []);
  useEffect(() => {
    let stop = false;
    setFilesLoading(true);
    void read<{ items: SalonDeliverable[] }>("/invite/salon/livrables").then((r) => {
      if (stop) return;
      setFilesLoading(false);
      if (r.ok) return (setItems(r.data.items), setFilesError(null));
      setFilesError(r.message);
      refused(r.refusal);
    });
    const again = setTimeout(refreshFiles, URL_FRESH_MS);
    return () => {
      stop = true;
      clearTimeout(again);
    };
  }, [round, refused, refreshFiles]);

  // Le fil : l'historique, puis le flux des nouveaux messages, rouvert après une coupure ou un silence.
  useEffect(() => {
    let stop = false;
    let es: EventSource | null = null;
    let since = 0;
    let heard = Date.now();
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      if (stop) return;
      es?.close();
      const s = new EventSource(`/invite/salon/stream?since=${since}`);
      es = s;
      const seen = (ev: MessageEvent) => {
        heard = Date.now();
        attempt = 0;
        const id = Number(ev.lastEventId);
        if (Number.isInteger(id) && id > since) since = id;
      };
      s.addEventListener("ping", seen);
      s.onmessage = (ev) => {
        seen(ev);
        try {
          const m = JSON.parse(String(ev.data)) as Message;
          setThread((t) => withMessage(t, m));
        } catch {
          /* not a message */
        }
      };
      s.addEventListener("end", (ev) => {
        s.close();
        const code = (JSON.parse(String((ev as MessageEvent).data ?? "{}")) as { code?: string }).code;
        refused(code === "access_ended" ? "ended" : "signed_out");
      });
      s.onerror = () => {
        if (s.readyState !== EventSource.CLOSED || stop) return;
        // Refused (session over) or the stream could not start: the guest routes say which.
        void read<unknown>("/invite/salon/participants").then((r) => {
          if (stop) return;
          if (!r.ok && r.refusal) return refused(r.refusal);
          retry = setTimeout(open, reconnectDelay(attempt++));
        });
      };
    };
    const watch = setInterval(() => {
      if (es && Date.now() - heard > SILENCE_MS) (heard = Date.now(), open());
    }, 5_000);
    // A key just admitted waits for the relay's next sync: the history is asked again until it answers.
    const load = (): void =>
      void read<{ messages: Message[]; refs: Message[]; me: string; now: number }>("/invite/salon/messages").then((r) => {
        if (stop) return;
        if (!r.ok) {
          if (r.refusal) return refused(r.refusal);
          if (attempt >= 1) setWaiting(true);
          retry = setTimeout(load, reconnectDelay(attempt++));
          return;
        }
        attempt = 0;
        setWaiting(false);
        setMe(r.data.me);
        setThread(sorted([...r.data.refs, ...r.data.messages]));
        since = r.data.now;
        open();
      });
    load();
    return () => {
      stop = true;
      clearTimeout(retry);
      clearInterval(watch);
      es?.close();
    };
  }, [link, refused]);

  const mine = useMemo(() => (me ? [me] : []), [me]);
  const labels = useMemo(() => labelsOf(directory), [directory]);
  const current: Conversation = useMemo(() => ({ id: channel, name: view.salon.nom, members: [...new Set([...directory.flatMap((e) => e.cles), ...mine])] }), [channel, view.salon.nom, directory, mine]);
  const deliverables = useMemo(() => ({ items, error: filesError, loading: filesLoading, refresh: refreshFiles }), [items, filesError, filesLoading, refreshFiles]);

  async function send(text: string, _mentions: string[], replyTo: Message | null): Promise<boolean> {
    setSending(true);
    try {
      const res = await fetch("/invite/salon/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: text, replyTo: replyTo?.id ?? null }), cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { message?: Message; error?: { message?: string } };
      const refusal = refusalOf(res.status);
      if (refusal) return (refused(refusal), false);
      if (!res.ok || !data.message) throw new Error(data.error?.message ?? "Message non envoyé. Réessayez dans un instant.");
      const m = data.message;
      setThread((t) => withMessage(t, m));
      return true;
    } catch (e) {
      toast.error(e instanceof TypeError ? "Message non envoyé. Réessayez dans un instant." : errorText(e));
      return false;
    } finally {
      setSending(false);
    }
  }

  async function logout() {
    await fetch("/invite/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
    onSignedOut();
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-surface">
      <header className="shrink-0 border-b border-line">
        <div className="flex items-center gap-3 px-4 pb-1 pt-3 lg:px-6">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-tint text-brand lg:size-10"><Hash className="h-4 w-4 lg:h-5 lg:w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] text-ink-3 lg:text-[12.5px]">Salon · vous êtes invité</span>
            <span className="block truncate font-display text-sm font-bold leading-tight text-ink lg:text-[17px]">{view.salon.nom}</span>
          </span>
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            <LogOut /> Se déconnecter
          </Button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2.5 py-2 sm:px-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => (setPane(t.id), t.id === "participants" && void loadPeople())}
              aria-current={pane === t.id ? "page" : undefined}
              className={cn("min-h-9 shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold", pane === t.id ? "bg-tint text-brand-ink" : "text-ink-2 hover:bg-soft")}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      {waiting && <p role="status" className="mx-4 mt-3 rounded-xl bg-soft px-4 py-2.5 text-sm text-ink-2">Connexion au salon en cours : votre accès s’active, cela peut prendre une minute.</p>}
      <div className="flex min-h-0 flex-1">
        <ExchangeThread
          current={current}
          salon
          pane={pane}
          thread={thread}
          mine={mine}
          labels={labels}
          directory={directory}
          failed={false}
          onRetry={() => setLink((l) => l + 1)}
          busy={[]}
          candidates={[]}
          sending={sending}
          onSend={send}
          deliverables={deliverables}
        />
      </div>
    </div>
  );
}
