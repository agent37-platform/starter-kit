"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, CircleAlert, CircleCheck, CircleX } from "lucide-react";
import { readApiError } from "@/lib/api";
import { useSupabase } from "@/lib/supabase/client";
import { AuthShell, AuthHeading } from "@/components/auth/AuthShell";
import { PasswordField } from "@/components/auth/Field";
import { PASSWORD_RULES, passwordIsValid, passwordScore } from "@/config/auth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const STRENGTH = ["bg-ko", "bg-ko", "bg-coral", "bg-ok"];

export default function ResetPasswordPage() {
  const supabase = useSupabase();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  // null = on vérifie encore la session de récupération.
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [done, setDone] = useState(false);
  const [link, setLink] = useState<{ tokenHash: string; type: string } | null>(null);
  // An invitation (type=invite) is a first visit, not a reset: its own words, straight into the space
  // once the password is chosen, and a new invitation in one click when it has expired (Leslie, 27/10).
  const invite = link?.type === "invite";
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    // Le lien de récupération passe par /auth/callback, qui ouvre une session avant de
    // rediriger ici. Pas d'utilisateur = lien invalide, déjà utilisé, expiré, ou ouvert
    // dans un autre navigateur que celui qui l'a demandé.
    if (supabase) {
      supabase()
        .then((c) => c.auth.getUser())
        .then(({ data }) => setHasSession(!!data.user));
      return;
    }
    // Through the back office the link is not consumed on arrival: it rides the URL until the new
    // password is sent with it. No token = the page was opened without a link.
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");
    const type = params.get("type");
    setLink(tokenHash && type ? { tokenHash, type } : null);
    setHasSession(Boolean(tokenHash && type));
  }, [supabase]);

  const score = useMemo(() => passwordScore(password), [password]);
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSave = passwordIsValid(password) && confirm === password && !loading;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setLoading(true);
    let failure: string | null = null;
    if (supabase) {
      failure = (await (await supabase()).auth.updateUser({ password })).error?.message ?? null;
    } else {
      try {
        const res = await fetch("/api/auth/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...link, password }),
        });
        if (!res.ok) {
          if (invite && res.status === 401) {
            setLoading(false);
            return setExpired(true);
          }
          failure = await readApiError(res, "Une erreur est survenue. Réessayez dans un instant.");
        }
      } catch {
        failure = "Connexion impossible. Vérifiez votre réseau, puis réessayez.";
      }
    }
    setLoading(false);
    if (failure) return toast.error(failure);
    if (invite) return window.location.replace("/");
    setDone(true);
  }

  if (hasSession === null) {
    return (
      <AuthShell>
        <p className="text-sm text-ink-3">Chargement…</p>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell>
        <span className="grid size-12 place-items-center rounded-2xl bg-ok-pale text-ok">
          <CircleCheck className="size-6" />
        </span>
        <AuthHeading title="Mot de passe changé">
          C’est fait. Par sécurité, vous êtes déconnecté de vos autres appareils.
        </AuthHeading>
        <a
          href={supabase ? "/login" : "/"}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-[15px] font-semibold text-on-brand hover:opacity-90"
        >
          {supabase ? "Se connecter" : "Entrer dans mon espace"} <ArrowRight className="size-[18px]" />
        </a>
      </AuthShell>
    );
  }

  if (expired && link) return <InviteExpired tokenHash={link.tokenHash} />;

  if (!hasSession) {
    return (
      <AuthShell>
        <span className="grid size-12 place-items-center rounded-2xl bg-ko-pale text-ko">
          <CircleX className="size-6" />
        </span>
        <AuthHeading title="Ce lien a expiré">
          Un lien de réinitialisation reste valable 24 heures et ne sert qu’une fois.
          Demandez-en un nouveau.
        </AuthHeading>
        <a
          href="/login"
          className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-[15px] font-semibold text-on-brand hover:opacity-90"
        >
          Recevoir un nouveau lien <ArrowRight className="size-[18px]" />
        </a>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      {invite ? (
        <AuthHeading title="Bienvenue sur Yelema">Créez votre mot de passe pour retrouver vos Experts.</AuthHeading>
      ) : (
        <AuthHeading title="Nouveau mot de passe">Choisissez-le, puis reconnectez-vous.</AuthHeading>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <PasswordField
          label={invite ? "Mot de passe" : "Nouveau mot de passe"}
          autoComplete="new-password"
          placeholder="8 caractères minimum"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <ul className="-mt-2 flex flex-wrap gap-x-3.5 gap-y-1.5 text-[12.5px] text-ink-3">
          {PASSWORD_RULES.map((r) => {
            const ok = r.test(password);
            return (
              <li key={r.key} className={cn("inline-flex items-center gap-1", ok && "text-ok")}>
                <Check className={cn("size-3.5", !ok && "opacity-40")} />
                {r.label}
              </li>
            );
          })}
        </ul>

        <span className="block h-[5px] overflow-hidden rounded-full bg-soft-2">
          <i
            className={cn(
              "block h-full rounded-full transition-[width,background-color] duration-200",
              STRENGTH[score]
            )}
            style={{ width: `${(score / PASSWORD_RULES.length) * 100}%` }}
          />
        </span>

        <PasswordField
          label="Confirmer"
          autoComplete="new-password"
          placeholder="Saisissez-le à nouveau"
          value={confirm}
          invalid={mismatch}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />

        {mismatch ? (
          <p className="-mt-1.5 flex items-center gap-1.5 text-[13px] text-ko">
            <CircleAlert className="size-4 shrink-0" />
            Les deux mots de passe ne sont pas identiques.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!canSave}
          className="mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-[15px] font-semibold text-on-brand hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Enregistrement…" : invite ? "Entrer dans mon espace" : "Enregistrer le mot de passe"}
          <ArrowRight className="size-[18px]" />
        </button>
      </form>
    </AuthShell>
  );
}

// An expired invitation: a new one by e-mail in one click (the back office sends it from the old link);
// if that cannot be done, who to ask. Never "a reset link lasts 30 minutes": this person has no password yet.
function InviteExpired({ tokenHash }: { tokenHash: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  async function resend() {
    setState("sending");
    try {
      const res = await fetch("/api/auth/resend-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenHash }),
      });
      setState(res.ok ? "sent" : "failed");
    } catch {
      setState("failed");
    }
  }

  return (
    <AuthShell>
      <span className={cn("grid size-12 place-items-center rounded-2xl", state === "sent" ? "bg-ok-pale text-ok" : "bg-ko-pale text-ko")}>
        {state === "sent" ? <CircleCheck className="size-6" /> : <CircleX className="size-6" />}
      </span>
      {state === "sent" ? (
        <AuthHeading title="C’est envoyé">Une nouvelle invitation vous attend dans votre boîte e-mail.</AuthHeading>
      ) : (
        <AuthHeading title="Cette invitation a expiré">
          {state === "failed" ? "Impossible de l’envoyer pour le moment. Demandez à la personne qui vous a invité de vous la renvoyer." : "Recevez-en une nouvelle par e-mail."}
        </AuthHeading>
      )}
      {state !== "sent" && state !== "failed" && (
        <button
          type="button"
          onClick={resend}
          disabled={state === "sending"}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-[15px] font-semibold text-on-brand hover:opacity-90 disabled:opacity-60"
        >
          {state === "sending" ? "Envoi…" : "Recevoir une nouvelle invitation"} <ArrowRight className="size-[18px]" />
        </button>
      )}
      <p className="text-center text-[13px] leading-relaxed text-ink-3">
        {state === "idle" || state === "sending" ? (
          <>
            Rien reçu ? Demandez à la personne qui vous a invité.
            <br />
          </>
        ) : null}
        <a href="/login" className="font-semibold text-brand-ink hover:underline">
          J’ai déjà un compte
        </a>
      </p>
    </AuthShell>
  );
}
