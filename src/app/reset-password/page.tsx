"use client";

import { useEffect, useState } from "react";
import { canResetPassword, updatePassword } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { branding } from "@/config/branding";
import { MIN_PASSWORD } from "@/config/auth";
import { toast } from "sonner";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // null = still checking for the recovery session.
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [done, setDone] = useState(false);
  // Neon reset links carry the token in the URL (?token=…); Supabase ones carry none.
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // Supabase: the recovery link routes through /auth/callback, which establishes a session
    // before redirecting here. Neon: the link brings a one-time token. Neither means the link was
    // invalid, already used, expired, or opened in a different browser than the one that requested it.
    const t = new URLSearchParams(window.location.search).get("token");
    setToken(t);
    canResetPassword(t).then(setHasSession);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) {
      return toast.error(`Password must be at least ${MIN_PASSWORD} characters.`);
    }
    setLoading(true);
    const { error } = await updatePassword(password, token);
    setLoading(false);
    if (error) return toast.error(error.message);
    setDone(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{branding.appName}</h1>
          {hasSession && !done && (
            <p className="text-sm text-muted-foreground">Choose a new password.</p>
          )}
        </div>

        {hasSession === null ? (
          <p className="text-center text-sm text-muted-foreground">Loading…</p>
        ) : done ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-card p-6 text-center text-sm">
              <p className="font-medium">Password updated</p>
              <p className="mt-1 text-muted-foreground">You&apos;re all set.</p>
            </div>
            <Button className="w-full" onClick={() => (window.location.href = "/dashboard")}>
              Continue to dashboard
            </Button>
          </div>
        ) : !hasSession ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-card p-6 text-center text-sm">
              <p className="font-medium">Reset link invalid or expired</p>
              <p className="mt-1 text-muted-foreground">
                Request a new password reset link to try again.
              </p>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => (window.location.href = "/login")}
            >
              Back to sign in
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={MIN_PASSWORD}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Updating..." : "Update password"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
