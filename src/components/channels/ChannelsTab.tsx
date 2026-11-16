"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { cached, remember } from "@/lib/client-cache";
import {
  channelError,
  channelStateLabel,
  hasChannelAccount,
  isChannelConnected,
  isFeaturedChannel,
  isSoonChannel,
  type ChannelsResponse,
  type MessagingPlatform,
} from "@/lib/channels";
import type { MergedAgent } from "@/lib/types";
import type { TelegramHubStatus } from "@/lib/agent37";
import { Button } from "@/components/ui/button";
import { channelBrand } from "@/components/channels/BrandIcons";
import { ChannelCredentialsForm } from "@/components/channels/ChannelCredentialsForm";
import { SlackConnect } from "@/components/channels/SlackConnect";
import { TeamsConnect } from "@/components/channels/TeamsConnect";
import { TelegramConnect } from "@/components/channels/TelegramConnect";
import { RelayChannel } from "@/components/channels/RelayChannel";
import { TelegramChannel } from "@/components/channels/TelegramChannel";
import { TelegramTopics } from "@/components/channels/TelegramTopics";
import { WhatsAppConnect } from "@/components/channels/WhatsAppConnect";
import { StatePill } from "@/components/integrations/StatePill";
import { useRuntimeTools, useTelegramRelay } from "@/components/experts/useRuntimeTools";

// The Messaging tab: connect this agent to the apps its owner already uses, so they can talk to it
// from their phone instead of only from this dashboard.
//
// The channel list is NOT hardcoded: it comes from the agent's own harness, which reports every
// channel it supports plus the credentials each one wants. Telegram, WhatsApp, Teams and Slack get a
// purpose-built panel (a bot to make, a QR to scan, an app to declare); everything else takes the
// generic credentials form built from what the harness asked for.
export function ChannelsTab({
  agentId,
  agent,
  canManage,
}: {
  agentId: string;
  agent: MergedAgent;
  // Connecting a channel: the agent's owner.
  canManage: boolean;
}) {
  // Reaching the harness runs a command inside the instance, which wakes a sleeper but cannot start a
  // stopped agent. Only a state that says the instance is down gives up without trying: an unknown
  // one means it could not be read, not that it is stopped.
  const reachable = !["stopped", "deleting", "deleted", "failed", "error"].includes(agent.live_status ?? "");
  // The channels below are the Hermes harness's own; a Claude Code instance has Telegram through its hub.
  const hermesTools = useRuntimeTools(agentId);
  const telegramRelay = useTelegramRelay(agentId);

  // What this page read last time, kept for the visit (Leslie, 28/10: « la page Canaux s'affiche très
  // lentement »): shown at once, the live state read again behind it.
  const memoKey = `channels:${agentId}`;
  // Kept in the browser across visits too (Leslie, 05/11: « la page Canaux charge très lentement, surtout les
  // boutons »): the last known state shows at once, the live one replaces it when the instance answers.
  const seen = cached<ChannelsResponse>(memoKey) ?? stored(memoKey);
  const [channels, setChannels] = useState<MessagingPlatform[] | null>(() => seen?.channels ?? null);
  // False while the rows come from the image's channel list and their state is still being read.
  const [stateKnown, setStateKnown] = useState(Boolean(seen));
  const [teamsEndpoint, setTeamsEndpoint] = useState<string | null>(() => seen?.teams_endpoint ?? null);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // Un bot posé par la passerelle (et relevé par l'instance) a déjà ses sujets : l'ancien bouton « Créer les sujets » s'efface.
  const [hubTelegram, setHubTelegram] = useState(false);
  // The hub is the gateway's (no exec): asked at once, alongside the channels and the runtime.
  useEffect(() => {
    let alive = true;
    apiFetch<TelegramHubStatus>(`/api/agents/${agentId}/channels/telegram/hub`).then((r) => alive && setHubTelegram(r.state?.active === true), () => undefined);
    return () => {
      alive = false;
    };
  }, [agentId]);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const res = await apiFetch<ChannelsResponse>(`/api/agents/${agentId}/channels`);
        const { channels: list, teams_endpoint } = res;
        remember(memoKey, res);
        store(memoKey, res);
        setChannels(list);
        setTeamsEndpoint(teams_endpoint ?? null);
        setStateKnown(true);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [agentId, memoKey]
  );

  // Started at once: the route answers no channel for a runtime that has none. The image's channel
  // list, when already known, shows first; the live state follows.
  useEffect(() => {
    if (!reachable) return;
    let alive = true;
    // A remembered answer already has the rows: only the live state is read.
    if (!cached(memoKey)) apiFetch<{ channels: MessagingPlatform[] | null; teams_endpoint: string | null }>(`/api/agents/${agentId}/channels?view=catalogue`).then(
      (r) => {
        if (!alive || !r.channels) return;
        setChannels((prev) => prev ?? r.channels);
        setTeamsEndpoint((prev) => prev ?? r.teams_endpoint ?? null);
      },
      () => undefined
    );
    void load();
    return () => {
      alive = false;
    };
  }, [reachable, load, agentId, memoKey]);

  if (hermesTools === false) {
    return (
      <div className="space-y-6">
        <Header />
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Telegram</h3>
          {telegramRelay ? <RelayChannel agentId={agentId} channel="telegram" canManage={canManage} /> : <TelegramChannel agentId={agentId} canManage={canManage} />}
        </section>
        <RelayChannel agentId={agentId} channel="slack" canManage={canManage} />
        <RelayChannel agentId={agentId} channel="teams" canManage={canManage} />
      </div>
    );
  }

  if (!reachable) {
    return (
      <div className="space-y-6">
        <Header />
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          Vos Experts ne sont pas joignables pour le moment. Réessayez dans un instant.
        </p>
      </div>
    );
  }

  const open = channels?.find((c) => c.id === openId) ?? null;
  if (open) {
    const back = () => {
      setOpenId(null);
      void load(true);
    };
    return (
      <div className="space-y-6">
        {open.id === "telegram" ? (
          <TelegramConnect agentId={agentId} agentName={agent.name} channel={open} onBack={back} />
        ) : open.id === "whatsapp" ? (
          <WhatsAppConnect agentId={agentId} channel={open} onBack={back} />
        ) : open.id === "teams" ? (
          <TeamsConnect agentId={agentId} channel={open} endpoint={teamsEndpoint} onBack={back} />
        ) : open.id === "slack" ? (
          <SlackConnect agentId={agentId} agentName={agent.name ?? ""} channel={open} onBack={back} />
        ) : (
          <ChannelCredentialsForm agentId={agentId} channel={open} onBack={back} />
        )}
      </div>
    );
  }

  const featured = (channels ?? []).filter((c) => isFeaturedChannel(c.id));
  // The other channels (WhatsApp, Discord, Signal…) show only once an account is linked, in any state, so it
  // can still be repaired or disconnected.
  const connectedRest = (channels ?? []).filter((c) => !isFeaturedChannel(c.id) && hasChannelAccount(c));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <Header />
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => load()} aria-label="Actualiser les canaux" className="max-sm:size-10">
          <RefreshCw className={loading ? "animate-spin" : undefined} />
        </Button>
      </div>

      {channels === null ? (
        // Before the image's list arrives, the first channels are known: their rows show at once, state pending.
        <div className="divide-y overflow-hidden rounded-[22px] border bg-card">
          {PLACEHOLDERS.map((channel) => (
            <ChannelRow key={channel.id} channel={channel} canManage={false} checking onOpen={() => undefined} />
          ))}
        </div>
      ) : (
        <>
          <div className="divide-y overflow-hidden rounded-[22px] border bg-card">
            {featured.map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                canManage={canManage}
                checking={!stateKnown}
                onOpen={() => setOpenId(channel.id)}
              />
            ))}
            {connectedRest.map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                canManage={canManage}
                checking={!stateKnown}
                onOpen={() => setOpenId(channel.id)}
              />
            ))}
          </div>

          {/* One Telegram topic per expert, once the bot is connected. */}
          {canManage && !hubTelegram && (
            <TelegramTopics
              agentId={agentId}
              telegramConnected={(channels ?? []).some((c) => c.id === "telegram" && isChannelConnected(c))}
            />
          )}

        </>
      )}
    </div>
  );
}

const STORE = "yelema:";
function stored(key: string): ChannelsResponse | undefined {
  try {
    const raw = window.localStorage.getItem(STORE + key);
    return raw ? (JSON.parse(raw) as ChannelsResponse) : undefined;
  } catch {
    return undefined;
  }
}
function store(key: string, value: ChannelsResponse) {
  try {
    window.localStorage.setItem(STORE + key, JSON.stringify(value));
  } catch {
    // Private window or full storage: the page reads the live state, as before.
  }
}

function Header() {
  return (
    <header className="space-y-1">
      <h2 className="text-lg font-semibold">Parler à vos Experts</h2>
      <p className="text-sm text-muted-foreground">Depuis les messageries que vous utilisez déjà.</p>
    </header>
  );
}

// A connected channel is one row to open (state, then a chevron); one to set up keeps its button.
const placeholder = (id: string, name: string): MessagingPlatform => ({
  id,
  name,
  description: null,
  docs_url: null,
  enabled: false,
  configured: false,
  gateway_running: false,
  state: null,
  error_code: null,
  error_message: null,
  home_channel: null,
  env_vars: [],
});
// In the order of the page (Telegram, Slack, Teams).
const PLACEHOLDERS = [placeholder("telegram", "Telegram"), placeholder("slack", "Slack"), placeholder("teams", "Microsoft Teams")];

// What each channel is for, in French: the harness's own descriptions are English (Leslie, 05/11).
const CHANNEL_TEXT: Record<string, string> = {
  telegram: "Écrivez à vos Experts depuis Telegram.",
  slack: "Vos Experts dans les canaux de votre équipe.",
  teams: "Vos Experts dans Microsoft Teams.",
  whatsapp: "Écrivez à vos Experts depuis WhatsApp.",
};

function ChannelRow({
  channel,
  canManage,
  checking = false,
  onOpen,
}: {
  channel: MessagingPlatform;
  canManage: boolean;
  /** The state is still being read: no button that would set up a channel already connected. */
  checking?: boolean;
  onOpen: () => void;
}) {
  const { Icon, color } = channelBrand(channel.id);
  const connected = isChannelConnected(channel);
  const error = channelError(channel);
  // Not while checking: an account already linked would flash « Bientôt » before its state arrives.
  const soon = !checking && isSoonChannel(channel.id) && !hasChannelAccount(channel);
  // One row, one pill of one size on the right, the whole row opens the channel (Leslie, 05/11: « Connecter »
  // alone, « Connecté » on green, the same buttons everywhere).
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={soon || !canManage || (checking && !connected && !error)}
      aria-label={soon ? `${channel.name} : bientôt disponible` : connected || error ? `Gérer ${channel.name}` : `Connecter ${channel.name}`}
      className="flex min-h-[68px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-soft disabled:pointer-events-none"
    >
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[12px] border bg-muted/20">
        <Icon className="h-5 w-5 shrink-0" {...(color ? { style: { color } } : {})} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{channel.name}</span>
        <span className="block truncate text-[13px] text-muted-foreground">{error ? "La connexion est à vérifier." : (CHANNEL_TEXT[channel.id] ?? channelStateLabel(channel))}</span>
      </span>
      {connected ? (
        <StatePill state="connected" />
      ) : error ? (
        <StatePill state="attention" />
      ) : soon ? (
        <StatePill state="soon" />
      ) : checking ? (
        <span className="inline-flex h-8 min-w-[108px] items-center justify-center" aria-label="Vérification">
          <Loader2 className="h-4 w-4 animate-spin text-ink-3" />
        </span>
      ) : (
        <StatePill state="connect" />
      )}
    </button>
  );
}
