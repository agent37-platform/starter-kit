"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, CircleAlert, Info, Mail } from "lucide-react";
import { useSupabase } from "@/lib/supabase/client";
import { usePublicConfig } from "@/components/PublicConfigProvider";
import { AuthShell, AuthHeading } from "@/components/auth/AuthShell";
import { Field, PasswordField } from "@/components/auth/Field";
import { readApiError } from "@/lib/api";
import { publicSiteOrigin, safeNextPath } from "@/lib/site-url";
import { toast } from "sonner";

// Pas d'inscription ici : chaque compte est créé par le back-office Yelema, qui envoie
// son lien d'accès. Trois écrans : connexion, demande de lien, lien envoyé.
type Mode = "signin" | "forgot" | "sent";

// POST to one of this app's /api/auth routes; the message to show when it refuses, else null.
async function post(path: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return res.ok ? null : await readApiError(res, "Une erreur est survenue. Réessayez dans un instant.");
  } catch {
    return "Connexion impossible. Vérifiez votre réseau, puis réessayez.";
  }
}

const RESEND_DELAY = 30;

export default function LoginPage() {
  const supabase = useSupabase();
  const { siteUrl } = usePublicConfig();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [expired, setExpired] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const sentTo = useRef("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Retour de déconnexion : on le dit, plutôt que de rendre un formulaire muet.
    if (params.get("out") === "1" || window.location.hash.startsWith("#out")) setSignedOut(true);
    // Sent here by a call refused in the middle of a page (see lib/api): say why.
    if (params.get("expired") === "1") setExpired(true);
    // /auth/callback renvoie ici avec ?error=auth quand un lien a expiré, a déjà servi,
    // ou a été ouvert dans un autre navigateur.
    if (params.get("error") === "auth") {
      toast.error("Ce lien n’est plus valable. Connectez-vous, ou demandez-en un nouveau.");
    }
    if (params.has("error") || params.has("out") || params.has("expired")) {
      params.delete("error");
      params.delete("out");
      params.delete("expired");
      const qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, []);

  // Compte à rebours avant de pouvoir redemander un lien.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  function go(next: Mode) {
    setMode(next);
    setPassword("");
    setError(null);
  }

  function callbackUrl(next: string): string {
    const url = new URL("/auth/callback", publicSiteOrigin(siteUrl, window.location.origin));
    url.searchParams.set("next", next);
    return url.toString();
  }

  async function sendResetLink(mail: string) {
    setLoading(true);
    let failure: string | null = null;
    if (supabase) {
      const { error: err } = await (await supabase()).auth.resetPasswordForEmail(mail, {
        redirectTo: callbackUrl("/reset-password"),
      });
      failure = err?.message ?? null;
    } else {
      // The back office sends the link, and answers the same whether or not the account exists.
      failure = await post("/api/auth/forgot", { email: mail });
    }
    setLoading(false);
    if (failure) return toast.error(failure);
    sentTo.current = mail;
    setCooldown(RESEND_DELAY);
    setMode("sent");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const mail = email.trim();
    if (!mail) return;

    if (mode === "forgot") return sendResetLink(mail);

    if (!password) return;
    setLoading(true);
    setError(null);
    let failure: string | null = null;
    if (supabase) {
      const { error: err } = await (await supabase()).auth.signInWithPassword({ email: mail, password });
      failure = err ? "Adresse ou mot de passe incorrect." : null;
    } else {
      // Through the back office: it says a wrong password, a suspended access, or too many tries.
      failure = await post("/api/auth/login", { email: mail, password });
    }
    setLoading(false);
    if (failure) {
      setError(failure);
      return;
    }
    // Navigation dure : les cookies de session fraîchement écrits partent avec la requête suivante.
    window.location.href = safeNextPath(new URLSearchParams(window.location.search).get("next"));
  }

  if (mode === "sent") {
    return (
      <AuthShell>
        <span className="grid size-12 place-items-center rounded-2xl bg-tint text-brand-ink">
          <Mail className="size-6" />
        </span>
        <AuthHeading title="Vérifiez vos emails">
          Un lien vient de partir vers <b className="text-ink">{sentTo.current}</b>. Il reste
          valable 24 heures.
        </AuthHeading>

        <div className="flex items-start gap-2.5 rounded-xl bg-soft px-3.5 py-3 text-[13.5px] text-ink-2">
          <Info className="mt-px size-4 shrink-0 text-ink-3" />
          <span>Rien reçu ? Regardez dans les courriers indésirables, ou vérifiez l’adresse.</span>
        </div>

        <p className="text-[13px] text-ink-2">
          Pas de lien ?{" "}
          <button
            type="button"
            disabled={cooldown > 0 || loading}
            onClick={() => sendResetLink(sentTo.current)}
            className="font-semibold text-link disabled:text-ink-3"
          >
            Renvoyer le lien
          </button>
          {cooldown > 0 ? <span className="text-ink-3"> (dans {cooldown} s)</span> : null}
        </p>
        <p className="text-[13px]">
          <button type="button" onClick={() => go("forgot")} className="font-semibold text-link">
            Changer d’adresse
          </button>
        </p>
      </AuthShell>
    );
  }

  const forgot = mode === "forgot";

  return (
    <AuthShell>
      {expired && !forgot ? (
        <p className="rounded-xl bg-soft px-3.5 py-3 text-sm font-semibold text-ink-2">
          Votre session a expiré. Reconnectez-vous pour reprendre où vous en étiez.
        </p>
      ) : null}
      {signedOut && !forgot ? (
        <p className="flex items-center gap-2 rounded-xl bg-ok-pale px-3.5 py-3 text-sm font-semibold text-ok">
          <CheckCircle2 className="size-4 shrink-0" />
          Vous êtes déconnecté. À bientôt.
        </p>
      ) : null}

      <AuthHeading title={forgot ? "Mot de passe oublié" : "Connexion à votre espace"}>
        {forgot
          ? "Indiquez votre adresse email. Nous vous envoyons un lien pour en choisir un nouveau."
          : "Entrez vos identifiants pour retrouver vos Experts."}
      </AuthHeading>

      {error ? (
        <p className="flex items-start gap-2.5 rounded-xl bg-ko-pale px-3.5 py-3 text-[13.5px] text-ko">
          <CircleAlert className="mt-px size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <Field
          label="Adresse email"
          type="email"
          autoComplete="username"
          placeholder="vous@entreprise.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        {!forgot && (
          <>
            <PasswordField
              label="Mot de passe"
              autoComplete="current-password"
              placeholder="Votre mot de passe"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <div className="flex justify-end text-sm">
              <button type="button" onClick={() => go("forgot")} className="font-semibold text-link">
                Mot de passe oublié ?
              </button>
            </div>
          </>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-[15px] font-semibold text-on-brand transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading
            ? forgot
              ? "Envoi…"
              : "Connexion…"
            : forgot
              ? "Recevoir le lien"
              : "Se connecter"}
          <ArrowRight className="size-[18px]" />
        </button>
      </form>

      {forgot ? (
        <p className="text-center text-[13px]">
          <button type="button" onClick={() => go("signin")} className="font-semibold text-link">
            Retour à la connexion
          </button>
        </p>
      ) : (
        <p className="text-center text-xs text-ink-3">
          Besoin d’un accès ? Demandez à votre administrateur de vous inviter.
        </p>
      )}
    </AuthShell>
  );
}
