"use client";

import { useEffect, useState } from "react";
import { requestPasswordReset, signIn, signUp } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { branding } from "@/config/branding";
import { MIN_PASSWORD } from "@/config/auth";
import { publicSiteOrigin, safeNextPath } from "@/lib/site-url";
import { toast } from "sonner";

type Mode = "signin" | "signup" | "reset";

const COPY: Record<Mode, { title: string; subtitle: string; cta: string; busy: string }> = {
  signin: { title: "Sign in", subtitle: "Welcome back.", cta: "Sign in", busy: "Signing in..." },
  signup: { title: "Create account", subtitle: `Get started with ${branding.appName}.`, cta: "Create account", busy: "Creating account..." },
  reset: { title: "Reset password", subtitle: "We'll email you a link to set a new password.", cta: "Send reset link", busy: "Sending..." },
};

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState<null | "signup" | "reset">(null);
  const [sentEmail, setSentEmail] = useState("");

  // /auth/callback bounces here with ?error=auth when a confirmation/recovery link
  // fails (expired, already used, or opened in a different browser). Surface it —
  // otherwise the user lands on a pristine form with no clue the link broke.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") !== "auth") return;
    toast.error("That link is invalid or has expired. Sign in, or request a new one.");
    params.delete("error");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);

  function switchMode(next: Mode) {
    setMode(next);
    setPassword("");
    setSent(null);
  }

  // /auth/callback exchanges the email link for a session, then redirects to `next`.
  function callbackUrl(next: string): string {
    const url = new URL("/auth/callback", publicSiteOrigin(window.location.origin));
    url.searchParams.set("next", next);
    return url.toString();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const mail = email.trim();
    if (!mail) return;

    const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));

    if (mode === "reset") {
      setLoading(true);
      const { error } = await requestPasswordReset(mail, {
        callbackUrl: callbackUrl("/reset-password"),
        resetPageUrl: new URL("/reset-password", publicSiteOrigin(window.location.origin)).toString(),
      });
      setLoading(false);
      if (error) return toast.error(error.message);
      setSentEmail(mail);
      setSent("reset");
      return;
    }

    if (!password) return;
    if (mode === "signup" && password.length < MIN_PASSWORD) {
      return toast.error(`Password must be at least ${MIN_PASSWORD} characters.`);
    }

    setLoading(true);
    if (mode === "signup") {
      const { session, error } = await signUp(mail, password, callbackUrl(next));
      setLoading(false);
      if (error) {
        // Email confirmation is off, so signing up an existing email errors here
        // (rather than sending a useless link) — steer them to sign in instead.
        if (error.code === "user_already_exists") {
          toast.error("That email already has an account. Sign in instead.");
          switchMode("signin");
          return;
        }
        return toast.error(error.message);
      }
      // Email confirmation is disabled: signUp returns a session immediately, so we
      // register-and-go with no inbox round-trip.
      if (session) {
        window.location.href = next;
        return;
      }
      // Fallback only reached if "Confirm email" is re-enabled on the project — then
      // there's no session until the user verifies via the emailed link.
      setSentEmail(mail);
      setSent("signup");
      return;
    }

    const { error } = await signIn(mail, password);
    setLoading(false);
    if (error) return toast.error(error.message);
    // Hard navigation so the freshly written auth cookies ride along on the next request.
    window.location.href = next;
  }

  const copy = COPY[mode];

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{branding.appName}</h1>
          <p className="text-sm text-muted-foreground">{copy.subtitle}</p>
        </div>

        {sent ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-card p-6 text-center text-sm">
              <p className="font-medium">Check your email</p>
              <p className="mt-1 text-muted-foreground">
                We sent {sent === "signup" ? "a confirmation" : "a password reset"} link to{" "}
                <span className="font-medium text-foreground">{sentEmail}</span>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {mode !== "reset" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {mode === "signin" && (
                    <button
                      type="button"
                      onClick={() => switchMode("reset")}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={mode === "signup" ? MIN_PASSWORD : undefined}
                  required
                />
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? copy.busy : copy.cta}
            </Button>

            <div className="text-center text-sm text-muted-foreground">
              {mode === "signin" && (
                <button type="button" onClick={() => switchMode("signup")} className="hover:text-foreground">
                  Don&apos;t have an account? <span className="font-medium text-foreground">Create one</span>
                </button>
              )}
              {mode === "signup" && (
                <button type="button" onClick={() => switchMode("signin")} className="hover:text-foreground">
                  Already have an account? <span className="font-medium text-foreground">Sign in</span>
                </button>
              )}
              {mode === "reset" && (
                <button type="button" onClick={() => switchMode("signin")} className="hover:text-foreground">
                  Back to sign in
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
