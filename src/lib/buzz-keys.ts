import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { apiFetch } from "@/lib/api";

// This browser's messaging key: generated here, kept in this browser only, never sent anywhere —
// only its public half is admitted on the client's relay (`POST /api/buzz/devices`). Lost storage =
// a new key; the old one is removed from the back office by the member or ages out with the device.

const STORE = "yelema.buzz.key";

function stored(): Uint8Array | null {
  try {
    const hex = localStorage.getItem(STORE);
    return hex && /^[0-9a-f]{64}$/.test(hex) ? hexToBytes(hex) : null;
  } catch {
    return null;
  }
}

function fresh(): Uint8Array {
  const sk = generateSecretKey();
  try {
    localStorage.setItem(STORE, bytesToHex(sk));
  } catch {
    /* private window: the key lives for this tab only */
  }
  return sk;
}

/** The key this browser already holds, if any — enough to open the relay before the back office answers. */
export function storedKey(): { secret: Uint8Array; pubkey: string } | null {
  const secret = stored();
  return secret ? { secret, pubkey: getPublicKey(secret) } : null;
}

const RELAY = "yelema.buzz.relais";

/** The relay address of the last overview (this tab only), so the next visit dials it at once. */
export function rememberedRelay(url?: string): string | null {
  try {
    if (url) sessionStorage.setItem(RELAY, url);
    return sessionStorage.getItem(RELAY);
  } catch {
    return null;
  }
}

const label = (): string => `Navigateur · ${new Date().toLocaleDateString("fr-FR")}`;

/** The browser's key, admitted for this member (a key another member already holds is replaced). */
export async function deviceKey(admitted: string[]): Promise<{ secret: Uint8Array; pubkey: string }> {
  let secret = stored() ?? fresh();
  let pubkey = getPublicKey(secret);
  if (admitted.includes(pubkey)) return { secret, pubkey };
  try {
    await apiFetch("/api/buzz/devices", { method: "POST", body: JSON.stringify({ pubkey, label: label() }) });
  } catch {
    secret = fresh();
    pubkey = getPublicKey(secret);
    await apiFetch("/api/buzz/devices", { method: "POST", body: JSON.stringify({ pubkey, label: label() }) });
  }
  return { secret, pubkey };
}
