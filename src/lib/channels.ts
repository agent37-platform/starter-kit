// Messaging channels: types shared by the BFF routes and the Messaging tab.
//
// The agent's harness owns the catalog: it reports every channel it supports, each channel's live
// state, and the exact credentials that channel wants (key, prompt, whether it is a secret, where to
// get it). So this app renders a form it did not write, and a channel the harness gains needs no
// change here. Telegram and WhatsApp get purpose-built panels on top because their setup is a flow
// rather than a form.

// One credential a channel asks for, as the harness describes it.
export interface ChannelField {
  key: string;
  required: boolean;
  is_set: boolean;
  redacted_value: string | null;
  description: string | null;
  prompt: string | null;
  help: string | null;
  url: string | null;
  is_password: boolean;
  advanced: boolean;
}

// The harness's own shape for a channel (GET /api/messaging/platforms inside the instance).
export interface MessagingPlatform {
  id: string;
  name: string;
  description: string | null;
  docs_url: string | null;
  enabled: boolean;
  configured: boolean;
  gateway_running: boolean;
  // "disabled" | "connected" | "starting" | "startup_failed" and so on, the harness's own wording, shown as-is.
  state: string | null;
  error_code: string | null;
  error_message: string | null;
  home_channel: string | null;
  env_vars: ChannelField[];
}

export interface ChannelsResponse {
  channels: MessagingPlatform[];
}

// The harness writes its own product name into the copy it ships ("Connect Hermes to Discord DMs").
// A white-label dashboard should not leak the harness it runs on, so the names are swapped for a
// neutral noun on the way to the browser. Add your own harness here if you ship a custom image.
const HARNESS_NAMES = /\b(Hermes|OpenClaw)\b/g;

export function neutralizeHarnessName<T extends string | null | undefined>(text: T): T {
  return (typeof text === "string" ? (text.replace(HARNESS_NAMES, "your agent") as T) : text);
}

// A channel is live when the harness says the gateway has it connected.
export function isChannelConnected(channel: MessagingPlatform): boolean {
  return channel.enabled && channel.state === "connected";
}

// The harness keeps the last failure on a channel even after it is switched off, so an error only
// counts while the channel is actually meant to be running.
export function channelError(channel: MessagingPlatform): string | null {
  return channel.enabled ? channel.error_message : null;
}

export function channelStateLabel(channel: MessagingPlatform): string {
  if (isChannelConnected(channel)) return "Connected";
  if (channelError(channel)) return "Needs attention";
  if (channel.enabled) return "Starting";
  if (channel.configured) return "Off";
  return "Not connected";
}

// A channel with no credentials to fill in cannot be connected from this app at all (it is set up
// inside the agent), so it is left off the list rather than offered as an empty form.
export function isConnectableChannel(channel: MessagingPlatform): boolean {
  return channel.env_vars.length > 0 || isGuidedChannel(channel.id);
}

// The four channels the Messaging tab leads with, in this order. Everything else the harness
// supports is still offered, folded under "More channels".
export const FEATURED_CHANNELS = ["telegram", "whatsapp", "slack", "discord"] as const;

// Telegram and WhatsApp connect through their own panel; the rest take a credentials form.
export const GUIDED_CHANNELS = ["telegram", "whatsapp"] as const;

export function isGuidedChannel(id: string): boolean {
  return (GUIDED_CHANNELS as readonly string[]).includes(id);
}

// Order the harness's list so the featured four lead, then everything else alphabetically.
export function sortChannels(channels: MessagingPlatform[]): MessagingPlatform[] {
  const rank = (id: string) => {
    const i = (FEATURED_CHANNELS as readonly string[]).indexOf(id);
    return i < 0 ? FEATURED_CHANNELS.length : i;
  };
  return [...channels].sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
}

export function isFeaturedChannel(id: string): boolean {
  return (FEATURED_CHANNELS as readonly string[]).includes(id);
}

// ---- Telegram ----

// What a pasted BotFather token turns out to be. Validated against Telegram before it is written
// into the agent, so a typo never takes the messaging gateway down.
export interface TelegramBotCheck {
  username: string;
  name: string | null;
}

// The owner Telegram picked up from the first message sent to their bot, or null while nobody has
// written to it yet.
export interface TelegramOwner {
  user_id: string;
  name: string | null;
}

// ---- WhatsApp ----

export type WhatsappPairingStatus =
  | "installing"
  | "starting"
  | "waiting"
  | "connected"
  | "error"
  | "expired"
  | "cancelled";

// The harness's pairing record, relayed as-is by the BFF (plus a rendered QR).
export interface WhatsappPairing {
  pairing_id?: string;
  status?: WhatsappPairingStatus;
  qr_payload?: string | null;
  account_phone?: string | null;
  error?: string | null;
}

// What the Messaging tab's WhatsApp panel sees. `linking` is ours: a scan has landed and the agent
// is still saving it, so the screen stops asking for a code it already got.
export type WhatsappUiStatus = "preparing" | "waiting" | "linking" | "connected" | "expired";

export interface WhatsappPairingState {
  pairing_id: string;
  status: WhatsappUiStatus;
  qr_data_url?: string;
  phone?: string | null;
}
