import "server-only";
import { createNeonAuth } from "@neon/auth/next/server";

// Neon Auth (Managed Better Auth), server side. Sessions are HTTP-only cookies on this app's own
// origin: the browser talks to /api/auth/* (src/app/api/auth/[...path]/route.ts), which proxies to
// NEON_AUTH_BASE_URL. Users live in the neon_auth schema of the same database as the app's tables.
type NeonAuth = ReturnType<typeof createNeonAuth>;

let cached: NeonAuth | null = null;

export function neonAuth(): NeonAuth {
  if (cached) return cached;
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl || !secret) {
    throw new Error(
      "The Neon backend needs NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET — run `npm run setup:neon`."
    );
  }
  cached = createNeonAuth({ baseUrl, cookies: { secret } });
  return cached;
}
