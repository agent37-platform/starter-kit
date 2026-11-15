import { useMemo } from "react";
import type { createBrowserClient } from "@supabase/ssr";
import { usePublicConfig } from "@/components/PublicConfigProvider";

type BrowserClient = ReturnType<typeof createBrowserClient>;
// The client, loaded on first use: supabase-js stays out of every page's first load.
export type SupabaseLoader = () => Promise<BrowserClient>;

// Browser Supabase client (Auth only — the tables are not reachable with the anon key). The
// URL and anon key come from the runtime config the root layout provides.
//
// Null when the back office owns the sign-in (authVia "backoffice"): the pages then go through
// this app's /api/auth routes and the browser never talks to Supabase.
export function useSupabase(): SupabaseLoader | null {
  const { authVia, supabaseUrl, supabaseAnonKey } = usePublicConfig();
  return useMemo(() => {
    if (authVia === "backoffice") return null;
    let client: Promise<BrowserClient> | null = null;
    return () => (client ??= import("@supabase/ssr").then((m) => m.createBrowserClient(supabaseUrl, supabaseAnonKey)));
  }, [authVia, supabaseUrl, supabaseAnonKey]);
}

// Sign out, whoever owns the sign-in. Shared by every "se déconnecter".
export async function signOutEverywhere(supabase: SupabaseLoader | null): Promise<void> {
  if (supabase) await (await supabase()).auth.signOut();
  else await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
}
