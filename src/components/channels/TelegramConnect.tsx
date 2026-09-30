"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import {
  isChannelConnected,
  type MessagingPlatform,
  type TelegramBotCheck,
  type TelegramOwner,
} from "@/lib/channels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChannelPanelHeader } from "@/components/channels/ChannelCredentialsForm";
import { useAsyncAction } from "@/components/useAsyncAction";

const OWNER_POLL_MS = 3000;

type Step = "token" | "owner" | "connected";

// Telegram is the channel worth building a real flow for: it reaches the agent through a webhook, so
// it works even when the agent is asleep, and nobody has to install anything.
//
// Three steps, and the middle one is the point: the first person to message the bot becomes its whole
// allowlist. Without that, anyone who guessed the bot's @username could talk to someone else's agent.
// We read that person from Telegram's own inbox rather than asking for a numeric user id nobody knows.
export function TelegramConnect({
  agentId,
  channel,
  onBack,
}: {
  agentId: string;
  channel: MessagingPlatform;
  onBack: () => void;
}) {
  const [step, setStep] = useState<Step>(isChannelConnected(channel) ? "connected" : "token");
  const [token, setToken] = useState("");
  const [bot, setBot] = useState<TelegramBotCheck | null>(null);
  const [owner, setOwner] = useState<TelegramOwner | null>(null);
  // Telegram refuses to hand over the inbox once the bot is on a webhook, which is what a bot that is
  // already wired to an agent looks like. Then there is nobody to wait for: offer to connect as-is.
  const [ownerUnavailable, setOwnerUnavailable] = useState(false);
  const { busy, run } = useAsyncAction();
  const connecting = useRef(false);

  const post = <T,>(body: Record<string, unknown>) =>
    apiFetch<T>(`/api/agents/${agentId}/channels/telegram`, { method: "POST", body: JSON.stringify(body) });

  const check = () =>
    run(async () => {
      const checked = await post<TelegramBotCheck>({ action: "check", token });
      setBot(checked);
      setOwner(null);
      setOwnerUnavailable(false);
      setStep("owner");
    });

  // Write the token (and whoever said hello) into the agent, then let the harness restart its gateway.
  const connect = (allowed: TelegramOwner | null) =>
    run(async () => {
      await apiFetch(`/api/agents/${agentId}/channels/telegram`, {
        method: "PUT",
        body: JSON.stringify({
          enabled: true,
          env: {
            TELEGRAM_BOT_TOKEN: token,
            TELEGRAM_ALLOWED_USERS: allowed?.user_id ?? "",
          },
        }),
      });
      setStep("connected");
      toast.success("Telegram connected");
    });

  // Watch the bot's inbox while the screen asks its owner to say hello. The first message connects the
  // agent on its own, so there is no button to press after Telegram.
  useEffect(() => {
    if (step !== "owner" || !bot || owner || ownerUnavailable) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await post<{ owner: TelegramOwner | null; unavailable: boolean }>({ action: "owner", token });
        if (cancelled) return;
        if (result.unavailable) {
          setOwnerUnavailable(true);
          return;
        }
        if (result.owner) {
          setOwner(result.owner);
          if (!connecting.current) {
            connecting.current = true;
            void connect(result.owner);
          }
          return;
        }
      } catch {
        // A miss is normal here (Telegram rate limits, a slow network): keep waiting rather than
        // throwing the user back to the token field.
      }
      if (!cancelled) timer = setTimeout(() => void poll(), OWNER_POLL_MS);
    };

    timer = setTimeout(() => void poll(), OWNER_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, bot, owner, ownerUnavailable, token]);

  const disconnect = () =>
    run(async () => {
      await apiFetch(`/api/agents/${agentId}/channels/telegram`, { method: "DELETE" });
      toast.success("Telegram disconnected");
      onBack();
    });

  return (
    <div className="space-y-5">
      <ChannelPanelHeader channel={channel} onBack={onBack} />

      {step === "token" && (
        <div className="space-y-4">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              Open{" "}
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                @BotFather
              </a>{" "}
              in Telegram and send <span className="font-medium text-foreground">/newbot</span>.
            </li>
            <li>Pick a name and a username for your agent&apos;s bot.</li>
            <li>Paste the token BotFather sends back.</li>
          </ol>
          <div className="space-y-1.5">
            <Label htmlFor="telegram-token" className="text-xs">
              Bot token
            </Label>
            <Input
              id="telegram-token"
              type="password"
              autoComplete="off"
              placeholder="123456789:AA..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={check} disabled={busy || token.trim().length === 0}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              Continue
            </Button>
            {channel.configured && (
              <Button variant="ghost" onClick={disconnect} disabled={busy}>
                Disconnect
              </Button>
            )}
          </div>
        </div>
      )}

      {step === "owner" && bot && (
        <div className="space-y-4">
          <p className="text-sm">
            Open <span className="font-medium">@{bot.username}</span> and send it any message. Whoever writes first is
            the only person the agent will answer.
          </p>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <a href={`https://t.me/${bot.username}`} target="_blank" rel="noopener noreferrer">
                Open @{bot.username}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
            <Button variant="ghost" onClick={() => connect(null)} disabled={busy}>
              {ownerUnavailable ? "Connect anyway" : "Skip"}
            </Button>
          </div>
          {ownerUnavailable ? (
            <p className="text-xs text-muted-foreground">
              This bot is already wired to something else, so Telegram will not show us who owns it. Connecting leaves
              the bot open to anyone who finds it.
            </p>
          ) : (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Waiting for your message
            </p>
          )}
        </div>
      )}

      {step === "connected" && (
        <div className="space-y-4">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {bot ? `@${bot.username} is connected.` : "Telegram is connected."}
              </p>
              <p className="text-xs text-muted-foreground">
                Message the bot from anywhere. Telegram reaches this agent by webhook, so it answers even when the
                agent is asleep.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {bot && (
              <Button asChild>
                <a href={`https://t.me/${bot.username}`} target="_blank" rel="noopener noreferrer">
                  Open chat
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                connecting.current = false;
                setToken("");
                setBot(null);
                setOwner(null);
                setStep("token");
              }}
            >
              Connect a different bot
            </Button>
            <Button variant="ghost" onClick={disconnect} disabled={busy}>
              Disconnect
            </Button>
          </div>
          {owner?.name && <p className="text-xs text-muted-foreground">Answering {owner.name} only.</p>}
        </div>
      )}
    </div>
  );
}
