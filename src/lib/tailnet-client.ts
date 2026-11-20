// Sensitive clients (yelema-platform docs/plans/couches-securite-clients-sensibles.md, layer 6): behind the tailnet's
// Apache, the member's Tailscale address arrives in X-Tailnet-Client; it is relayed to the back office, which checks
// that device belongs to the signed-in member. The back office trusts it only from our own container.
// Pure part here, so the rule is tested; `requestTailnetClient` reads the current request.

const TAILNET_V4 = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/;

/** The header to relay, or none: only a Tailscale IPv4 address (100.64.0.0/10) is passed on. */
export function tailnetClientHeader(value: string | null | undefined): Record<string, string> {
  const v = value?.trim() ?? "";
  return TAILNET_V4.test(v) ? { "X-Tailnet-Client": v } : {};
}

/** Outside a request (a scheduled job), there is no member to vouch for: nothing is relayed. */
export async function requestTailnetClient(): Promise<Record<string, string>> {
  try {
    const { headers } = await import("next/headers");
    return tailnetClientHeader((await headers()).get("x-tailnet-client"));
  } catch {
    return {};
  }
}
