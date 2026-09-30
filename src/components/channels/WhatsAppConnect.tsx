"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { isChannelConnected, type MessagingPlatform, type WhatsappPairingState } from "@/lib/channels";
import { Button } from "@/components/ui/button";
import { ChannelPanelHeader } from "@/components/channels/ChannelCredentialsForm";
import { useAsyncAction } from "@/components/useAsyncAction";

const POLL_MS = 2500;

// WhatsApp links a phone instead of taking a token: the agent opens a WhatsApp session and prints the
// same QR code the phone app expects, and this panel relays it. The code rotates every few seconds, so
// the poll that watches for a scan also refreshes what is on screen.
//
// The linked number becomes the whole allowlist and the chat is the owner's own "Message yourself"
// thread, which is the one setup that needs no second phone.
export function WhatsAppConnect({
  agentId,
  channel,
  onBack,
}: {
  agentId: string;
  channel: MessagingPlatform;
  onBack: () => void;
}) {
  const [session, setSession] = useState<WhatsappPairingState | null>(
    isChannelConnected(channel) ? { pairing_id: "", status: "connected" } : null
  );
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { busy, run } = useAsyncAction();
  // Starting a second pairing on the same agent cancels the first, so React's two strict-mode mounts
  // must share ONE start or the screen shows the code that just died.
  const started = useRef<Promise<WhatsappPairingState> | null>(null);

  const alreadyConnected = isChannelConnected(channel);

  useEffect(() => {
    if (alreadyConnected) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setError(null);

    const pair = (body: Record<string, unknown>) =>
      apiFetch<WhatsappPairingState>(`/api/agents/${agentId}/channels/whatsapp`, {
        method: "POST",
        body: JSON.stringify({ action: "pair", ...body }),
      });

    const land = (result: WhatsappPairingState) => {
      if (cancelled) return;
      setSession(result);
      if (result.status === "connected" || result.status === "linking") return;
      if (result.status === "expired") {
        setError("That code expired. Start again.");
        return;
      }
      timer = setTimeout(() => void poll(result.pairing_id), POLL_MS);
    };

    const fail = (cause: unknown) => {
      if (cancelled) return;
      setSession(null);
      setError((cause as Error).message);
    };

    // Saving a landed scan is a second call, so it goes out before the panel gets a say: closing the tab
    // on a scan that already worked must not leave the number unapplied.
    const settle = (result: WhatsappPairingState) => {
      if (result.status === "linking") void poll(result.pairing_id, true);
      land(result);
    };

    const poll = async (pairingId: string, finish = false) => {
      try {
        settle(await pair({ pairing_id: pairingId, ...(finish ? { finish: true } : {}) }));
      } catch (cause) {
        fail(cause);
      }
    };

    if (!started.current) started.current = pair({});
    started.current.then((result) => !cancelled && settle(result)).catch(fail);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, attempt, alreadyConnected]);

  const disconnect = () =>
    run(async () => {
      await apiFetch(`/api/agents/${agentId}/channels/whatsapp`, { method: "DELETE" });
      toast.success("WhatsApp disconnected");
      onBack();
    });

  const retry = () => {
    started.current = null;
    setSession(null);
    setAttempt((v) => v + 1);
  };

  return (
    <div className="space-y-5">
      <ChannelPanelHeader channel={channel} onBack={onBack} />

      {session?.status === "connected" ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {session.phone ? `+${session.phone} is connected.` : "WhatsApp is connected."}
              </p>
              <p className="text-xs text-muted-foreground">
                Open the chat with yourself in WhatsApp and message the agent there. Nobody else can reach it.
              </p>
            </div>
          </div>
          <Button variant="ghost" onClick={disconnect} disabled={busy}>
            Disconnect
          </Button>
        </div>
      ) : error ? (
        <div className="space-y-3">
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
          <Button onClick={retry}>Try again</Button>
        </div>
      ) : session?.status === "linking" ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Scan received. Saving it on the agent, about a minute.
        </div>
      ) : session?.status === "waiting" && session.qr_data_url ? (
        <div className="space-y-4">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>On your phone, open WhatsApp.</li>
            <li>
              Go to <span className="font-medium text-foreground">Settings, Linked devices, Link a device</span>.
            </li>
            <li>Point your phone at the code below.</li>
          </ol>
          <div className="flex flex-col items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={session.qr_data_url}
              alt="WhatsApp linking QR code"
              className="h-56 w-56 rounded-md bg-white p-2"
            />
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Waiting for you to scan
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Getting your code ready. The first time takes a minute.</p>
        </div>
      )}
    </div>
  );
}
