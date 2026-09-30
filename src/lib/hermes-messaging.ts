import "server-only";
import { agent37 } from "@/lib/agent37";
import { ApiError } from "@/lib/http";
import type { MessagingPlatform, WhatsappPairing } from "@/lib/channels";

// Hermes serves its own messaging API on a LOOPBACK port inside the instance (9119), so it is
// reachable only from inside the sandbox, which is exactly what POST /v1/instances/{id}/exec gives
// us (https://www.agent37.com/docs/agents-api/exec). Every call below is one exec that curls the
// in-sandbox API and prints the JSON back.
//
// Its session token is minted per dashboard start and injected into that SPA's HTML, so each call
// scrapes it first. That is Hermes's own auth, not ours: this app's own auth already happened in the
// BFF route before we got here.
const DASHBOARD_ORIGIN = "http://127.0.0.1:9119";
const OUTPUT_MARKER = "A37_HERMES_JSON:";

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function script(method: string, path: string, body?: unknown): string {
  const payload = body === undefined ? "" : ` -H 'content-type: application/json' -d ${quote(JSON.stringify(body))}`;
  return [
    `token=$(curl -sS --max-time 10 ${DASHBOARD_ORIGIN}/ | grep -o '__HERMES_SESSION_TOKEN__="[^"]*"' | head -1 | cut -d'"' -f2)`,
    // No marker printed: an unreachable dashboard has to read as "try again", never as a bad answer.
    `[ -n "$token" ] || { echo 'no hermes session token' >&2; exit 1; }`,
    `printf '%s' '${OUTPUT_MARKER}'`,
    `curl -sS --max-time 90 -X ${method} -H "X-Hermes-Session-Token: $token"${payload} ${quote(`${DASHBOARD_ORIGIN}${path}`)}`,
  ].join("\n");
}

// Run one call against the instance's own messaging API. Throws ApiError when the sandbox could not
// be reached or answered with something that is not JSON. The caller's channel UI shows that as
// "try again", which is the honest reading of a gateway that is still booting.
async function dashboard<T>(agentId: string, method: string, path: string, body?: unknown): Promise<T> {
  const result = await agent37.exec(agentId, script(method, path, body));
  const marked = result.stdout.indexOf(OUTPUT_MARKER);
  if (marked < 0) {
    console.error(`[channels] ${method} ${path} failed on ${agentId}`, result.stderr || result.stdout);
    throw new ApiError(502, "channel_unavailable", "The agent's messaging setup is not reachable right now. Try again shortly.");
  }
  try {
    return JSON.parse(result.stdout.slice(marked + OUTPUT_MARKER.length).trim()) as T;
  } catch {
    console.error(`[channels] ${method} ${path} returned no JSON on ${agentId}`, result.stdout.slice(marked, marked + 500));
    throw new ApiError(502, "channel_unavailable", "The agent's messaging setup returned an unexpected answer. Try again shortly.");
  }
}

interface PlatformsResponse {
  platforms: MessagingPlatform[];
}

// Every channel the agent's harness supports, with its live state and the credentials it wants.
// The harness is the catalog: this app never hardcodes the field list, so a channel the harness
// adds shows up here on its own.
export async function listPlatforms(agentId: string): Promise<MessagingPlatform[]> {
  const { platforms } = await dashboard<PlatformsResponse>(agentId, "GET", "/api/messaging/platforms");
  return platforms ?? [];
}

export async function getPlatform(agentId: string, platformId: string): Promise<MessagingPlatform> {
  const platform = (await listPlatforms(agentId)).find((p) => p.id === platformId);
  if (!platform) throw new ApiError(404, "not_found", "This agent does not support that channel");
  return platform;
}

interface PlatformUpdateResponse {
  ok?: boolean;
  // false when the change needs a gateway restart to take effect.
  hot_served?: boolean;
  detail?: string;
}

// Write a channel's credentials and switch it on (or off). A change the running gateway cannot pick
// up live comes back `hot_served: false`, and then the restart is what actually connects it.
export async function writePlatform(
  agentId: string,
  platformId: string,
  update: { enabled?: boolean; env?: Record<string, string>; clear_env?: string[] }
): Promise<void> {
  const result = await dashboard<PlatformUpdateResponse>(
    agentId,
    "PUT",
    `/api/messaging/platforms/${encodeURIComponent(platformId)}`,
    update
  );
  if (result.ok !== true) {
    throw new ApiError(502, "channel_write_failed", result.detail || "The agent refused that channel configuration.");
  }
  if (result.hot_served !== true) await dashboard(agentId, "POST", "/api/gateway/restart");
}

// ---- WhatsApp: a QR pairing, not a credential ----
// WhatsApp links a phone rather than taking a token, so the harness runs the pairing itself and we
// relay it: start opens the socket, the poll republishes the rotating code, and apply saves the
// linked number as the allowlist once a scan lands.

const WHATSAPP_ONBOARDING = "/api/messaging/whatsapp/onboarding";

export function startWhatsappPairing(agentId: string): Promise<WhatsappPairing> {
  return dashboard<WhatsappPairing>(agentId, "POST", `${WHATSAPP_ONBOARDING}/start`, { mode: "self-chat" });
}

export function readWhatsappPairing(agentId: string, pairingId: string): Promise<WhatsappPairing> {
  return dashboard<WhatsappPairing>(agentId, "GET", `${WHATSAPP_ONBOARDING}/${encodeURIComponent(pairingId)}`);
}

export function applyWhatsappPairing(agentId: string, pairingId: string): Promise<{ ok?: boolean; detail?: string }> {
  return dashboard(agentId, "POST", `${WHATSAPP_ONBOARDING}/${encodeURIComponent(pairingId)}/apply`, {});
}
