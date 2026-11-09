"use client";

import { createAuthClient } from "@neon/auth/next";

// Neon Auth browser client. It calls this app's /api/auth/* proxy, never Neon directly, so no Neon
// URL or key is shipped to the browser.
let cached: ReturnType<typeof createAuthClient> | null = null;

export function neonAuthClient() {
  if (!cached) cached = createAuthClient();
  return cached;
}
