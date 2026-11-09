"use client";

import { BACKEND } from "@/lib/backend";

// The browser-side auth calls the login, reset-password and account UI make, for whichever backend
// NEXT_PUBLIC_BACKEND selects. Each SDK is imported lazily so only the active one is loaded.
//
//  - supabase: Supabase Auth straight from the browser (anon key); email links come back through
//    /auth/callback, which exchanges them for a session.
//  - neon:     Neon Auth (Managed Better Auth) through this app's /api/auth/* proxy; the session is an
//    HTTP-only cookie on this origin. Reset links land on /reset-password?token=….

export interface AuthResult {
  error?: { message: string; code?: string };
}

const supabase = async () => (await import("@/lib/supabase/client")).createClient();
const neon = async () => (await import("@/lib/neon/client")).neonAuthClient();

function neonError(error: { message?: string; code?: string; statusText?: string } | null | undefined) {
  if (!error) return undefined;
  const code = error.code && /USER_ALREADY_EXISTS/.test(error.code) ? "user_already_exists" : error.code;
  return { message: error.message || error.statusText || "Something went wrong", code };
}

// `session` is false when the project still requires email confirmation, so the caller shows a
// "check your email" screen instead of navigating.
export async function signUp(
  email: string,
  password: string,
  confirmRedirect: string
): Promise<AuthResult & { session: boolean }> {
  if (BACKEND === "neon") {
    const { data, error } = await (await neon()).signUp.email({
      email,
      password,
      name: email.split("@")[0] || email,
    });
    return { error: neonError(error), session: Boolean(data?.token) };
  }
  const { data, error } = await (await supabase()).auth.signUp({
    email,
    password,
    options: { emailRedirectTo: confirmRedirect },
  });
  return { error: error ? { message: error.message, code: error.code } : undefined, session: Boolean(data.session) };
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  if (BACKEND === "neon") {
    const { error } = await (await neon()).signIn.email({ email, password });
    return { error: neonError(error) };
  }
  const { error } = await (await supabase()).auth.signInWithPassword({ email, password });
  return { error: error ? { message: error.message, code: error.code } : undefined };
}

export async function signOut(): Promise<void> {
  if (BACKEND === "neon") await (await neon()).signOut();
  else await (await supabase()).auth.signOut();
}

// Sends the reset email. `callbackUrl` is the Supabase /auth/callback URL; Neon links go to
// `resetPageUrl` directly with ?token=.
export async function requestPasswordReset(
  email: string,
  urls: { callbackUrl: string; resetPageUrl: string }
): Promise<AuthResult> {
  if (BACKEND === "neon") {
    const { error } = await (await neon()).requestPasswordReset({ email, redirectTo: urls.resetPageUrl });
    return { error: neonError(error) };
  }
  const { error } = await (await supabase()).auth.resetPasswordForEmail(email, { redirectTo: urls.callbackUrl });
  return { error: error ? { message: error.message, code: error.code } : undefined };
}

// Whether /reset-password can set a new password: Supabase needs the recovery session that
// /auth/callback established; Neon needs the token from the emailed link.
export async function canResetPassword(token: string | null): Promise<boolean> {
  if (BACKEND === "neon") return Boolean(token);
  const { data } = await (await supabase()).auth.getUser();
  return Boolean(data.user);
}

export async function updatePassword(password: string, token: string | null): Promise<AuthResult> {
  if (BACKEND === "neon") {
    if (!token) return { error: { message: "Reset link invalid or expired" } };
    const { error } = await (await neon()).resetPassword({ newPassword: password, token });
    return { error: neonError(error) };
  }
  const { error } = await (await supabase()).auth.updateUser({ password });
  return { error: error ? { message: error.message, code: error.code } : undefined };
}
