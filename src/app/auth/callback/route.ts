import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { authViaBackoffice, multiTenant, siteUrl } from "@/lib/runtime-config";
import { requestSiteOrigin, safeNextPath } from "@/lib/site-url";
import { hostOf } from "@/lib/tenant-resolver";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(url.searchParams.get("next"));
  // Behind a reverse proxy request.url carries the listen address (0.0.0.0:3000), not the public host.
  const origin = requestSiteOrigin(multiTenant(), siteUrl(), hostOf(request.headers), url.origin);

  if (authViaBackoffice()) {
    // The back office consumes the link together with the new password (POST /api/auth/accept), so
    // it is NOT verified here: it goes on to the page that asks for the password.
    if (!tokenHash || !type) return NextResponse.redirect(new URL("/login?error=auth", origin));
    const target = new URL("/reset-password", origin);
    target.searchParams.set("token_hash", tokenHash);
    target.searchParams.set("type", type);
    return NextResponse.redirect(target);
  }

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }

  return NextResponse.redirect(new URL("/login?error=auth", origin));
}
