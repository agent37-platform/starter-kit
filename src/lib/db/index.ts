import "server-only";
import { BACKEND } from "@/lib/backend";
import { createNeonStore } from "./neon";
import { createSupabaseStore } from "./supabase";
import type { Store } from "./types";

export type { Store } from "./types";

// The privileged data layer for whichever backend NEXT_PUBLIC_BACKEND selects. Server-only; every
// call must be gated by the checks in src/lib/auth.ts first.
let cached: Store | null = null;

export function getStore(): Store {
  if (!cached) cached = BACKEND === "neon" ? createNeonStore() : createSupabaseStore();
  return cached;
}
