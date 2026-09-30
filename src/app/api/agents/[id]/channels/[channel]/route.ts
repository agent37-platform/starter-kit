import QRCode from "qrcode";
import { requireAgentAccess } from "@/lib/auth";
import { ApiError, handleError, json, readJson } from "@/lib/http";
import {
  applyWhatsappPairing,
  getPlatform,
  readWhatsappPairing,
  startWhatsappPairing,
  writePlatform,
} from "@/lib/hermes-messaging";
import { assertBotTokenShape, checkBotToken, findBotOwner } from "@/lib/telegram";
import type { MessagingPlatform, WhatsappPairing, WhatsappPairingState } from "@/lib/channels";

// Every handler here is one or more execs into the instance, and a write also restarts the agent's
// messaging gateway, a minute of work in the slowest case.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string; channel: string }> };

const QR_OPTIONS = { margin: 1, width: 224 } as const;

// Credentials are written by the harness, which redacts them on the way back out, so the refreshed
// channel is safe to return to the browser.
async function refreshed(agentId: string, channelId: string): Promise<MessagingPlatform> {
  return getPlatform(agentId, channelId);
}

// Connect (or re-configure) a channel: write its credentials, switch it on, and let the harness
// restart its gateway. Admin-only, because a channel is a door into the agent.
//
// A Telegram token is checked against Telegram FIRST: the messaging gateway refuses to start on a
// bad token, so writing one unchecked would take every other channel on the agent down with it.
export async function PUT(request: Request, { params }: Ctx) {
  try {
    const { id, channel } = await params;
    await requireAgentAccess(id, "admin");

    const body = await readJson<{ env?: Record<string, string>; enabled?: boolean }>(request);
    const platform = await getPlatform(id, channel);

    const env: Record<string, string> = {};
    for (const field of platform.env_vars) {
      const value = body.env?.[field.key];
      // An untouched secret arrives absent, not blank: leave what the agent already holds.
      if (typeof value !== "string") continue;
      env[field.key] = value.trim();
    }
    const missing = platform.env_vars.filter((f) => f.required && !f.is_set && !env[f.key]);
    if (missing.length > 0) {
      throw new ApiError(400, "invalid_request", `${missing.map((f) => f.prompt || f.key).join(", ")} is required`);
    }
    if (channel === "telegram" && env.TELEGRAM_BOT_TOKEN) {
      await checkBotToken(assertBotTokenShape(env.TELEGRAM_BOT_TOKEN));
    }

    await writePlatform(id, channel, { enabled: body.enabled ?? true, env });
    return json({ channel: await refreshed(id, channel) });
  } catch (e) {
    return handleError(e);
  }
}

// Disconnect: switch the channel off and forget its credentials.
export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { id, channel } = await params;
    await requireAgentAccess(id, "admin");

    const platform = await getPlatform(id, channel);
    await writePlatform(id, channel, { enabled: false, clear_env: platform.env_vars.map((f) => f.key) });
    return json({ channel: await refreshed(id, channel) });
  } catch (e) {
    return handleError(e);
  }
}

// The steps that are a flow rather than a form. Telegram checks a pasted token and then waits for its
// owner to say hello; WhatsApp relays the agent's QR pairing.
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id, channel } = await params;
    await requireAgentAccess(id, "admin");

    const body = await readJson<{ action?: string; token?: string; pairing_id?: string; finish?: boolean }>(request);

    if (channel === "telegram" && body.action === "check") {
      return json(await checkBotToken(assertBotTokenShape(body.token ?? "")));
    }
    if (channel === "telegram" && body.action === "owner") {
      return json(await findBotOwner(assertBotTokenShape(body.token ?? "")));
    }
    if (channel === "whatsapp" && body.action === "pair") {
      return json(await pairWhatsapp(id, body.pairing_id, body.finish === true));
    }

    throw new ApiError(400, "invalid_request", "Unsupported action for this channel");
  } catch (e) {
    return handleError(e);
  }
}

// One call for the whole pairing: no pairing id starts a session, a pairing id reports where that one
// got to, and `finish` saves a scan that has landed. Saving restarts the gateway, so the scan is
// reported first and applied on the call that answers it, so the screen never keeps asking for a
// code it already got.
async function pairWhatsapp(agentId: string, pairingId: string | undefined, finish: boolean): Promise<WhatsappPairingState> {
  const session: WhatsappPairing = pairingId
    ? await readWhatsappPairing(agentId, pairingId)
    : await startWhatsappPairing(agentId);
  const id = pairingId || session.pairing_id || "";

  if (session.status === "connected") {
    if (!finish) return { pairing_id: id, status: "linking" };
    const applied = await applyWhatsappPairing(agentId, id);
    if (applied.ok !== true) {
      throw new ApiError(502, "pairing_failed", applied.detail || "WhatsApp linked but could not be saved. Try again.");
    }
    return { pairing_id: id, status: "connected", phone: session.account_phone ?? null };
  }
  if (session.status === "error") {
    throw new ApiError(502, "pairing_failed", session.error || "WhatsApp setup failed.");
  }
  if (session.status === "waiting" && session.qr_payload) {
    return { pairing_id: id, status: "waiting", qr_data_url: await QRCode.toDataURL(session.qr_payload, QR_OPTIONS) };
  }
  // The first pairing installs the WhatsApp bridge inside the agent, so the first code takes a moment.
  const preparing = session.status === "installing" || session.status === "starting" || session.status === "waiting";
  return { pairing_id: id, status: preparing ? "preparing" : "expired" };
}
