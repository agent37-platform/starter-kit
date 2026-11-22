"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Check, CircleDashed, Plug, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { FIX, pointsLeft, readiness, stage, type JourZero, type Stage } from "@/lib/jour-zero";
import { cn } from "@/lib/utils";
import { useDeployPhase } from "@/components/app/DeployStatus";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cached, cachedFetch } from "@/lib/client-cache";

const TONE = {
  ready: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  absent: "bg-soft text-ink-3",
};
// One shape for the states, as an icon, 14 px (Leslie, 03/11; 04/11: « un peu plus petites »): a green disc with a check once ready, an amber
// ring half drawn while points are left, a grey dashed ring before anything (chip only, never beside the name).
function StateIcon({ state }: { state: "ready" | "partial" | "absent" }) {
  if (state === "ready")
    return (
      <span className="grid size-3.5 place-items-center rounded-full bg-emerald-500 text-white">
        <Check className="size-2.5" strokeWidth={3.5} />
      </span>
    );
  if (state === "partial")
    return (
      <svg viewBox="0 0 18 18" className="size-3.5 text-amber-500" aria-hidden>
        <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="2.5" />
        <path d="M9 2a7 7 0 0 1 0 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  return <CircleDashed className="size-3.5 text-ink-3" strokeWidth={2.5} aria-hidden />;
}

// Whether the expert has done its day-zero preparation: a chip, and its checks behind it.
export function ExpertReadiness({
  agentId,
  profileId,
  expertName,
  className,
  variant = "chip",
  pronoun = null,
  onCommand,
  onStage,
}: {
  agentId: string;
  profileId: string;
  expertName: string;
  /** Kept for the callers; each point now links to its own page. */
  onOpenTools?: () => void;
  className?: string;
  variant?: "chip" | "dot" | "banner";
  /** « elle » or « il » from the catalogue: « prête », « Ce qu'elle sait ». */
  pronoun?: "elle" | "il" | null;
  /** The banner's buttons run a command in the conversation (« /onboarding »…); the client never sees it. */
  onCommand?: (text: string) => void;
  /** Where the expert stands (null while unknown): the empty conversation shows one action at a time. */
  onStage?: (s: Stage | null) => void;
}) {
  const jzKey = `jour-zero:${agentId}:${profileId}`;
  const [jz, setJz] = useState<JourZero | null>(() => cached<JourZero>(jzKey) ?? null);
  const [open, setOpen] = useState(false);
  const updating = useDeployPhase() === "maintenance";

  // Changes as the expert prepares itself: kept a minute, so moving between experts asks nothing.
  useEffect(() => {
    let live = true;
    setJz(cached<JourZero>(jzKey) ?? null);
    cachedFetch(jzKey, () => apiFetch<JourZero>(`/api/agents/${agentId}/experts/${profileId}/jour-zero`), 60_000).then(
      (r) => live && setJz(r),
      () => undefined
    );
    return () => {
      live = false;
    };
  }, [agentId, profileId, jzKey]);

  // « Faire connaissance » is offered to every expert until it is done (its journal says so) or until it has
  // made INTRO_MAX deliverables (ChatView). A folder that merely holds files (installed by the pack, or an old
  // document) no longer hides it: that was why it showed for some experts and not others (Leslie, 19/11).
  // The chip beside the name still treats such an expert as at work.
  const st = jz ? stage(jz) : null;
  useEffect(() => onStage?.(st), [onStage, st]);

  // During an update the strip under the top bar says so (DeployStatus): no chip beside the name.
  // The banner above the chat bar has nothing to say then, nor once the expert is ready.
  // Before « Faire connaissance » the banner says nothing either: that is the first request under the chat bar.
  if (variant === "banner" && (updating || !jz || jz.working || stage(jz) !== "left")) return null;
  // « Prêt » stays beside the name once the expert is ready (Leslie, 01/11, back on her 31/10 choice).
  if (!jz) return null;
  // Beside the name, every expert that answers shows the green check (Leslie, 03/11: the grey dashed ring
  // « ne veut rien dire »): at work without a preparation file, or not prepared yet, it works all the same.
  // Only a point left to settle changes the icon (amber ring), and only then does a click open something.
  if (variant === "dot" && (jz.working || readiness(jz).state !== "partial"))
    return (
      <span role="img" title="Fonctionne" aria-label="Fonctionne" className={cn("grid size-6 shrink-0 place-items-center", className)}>
        <StateIcon state="ready" />
      </span>
    );
  if (jz.working) return null;
  const r = readiness(jz);
  const Icon = r.state === "ready" ? Check : CircleDashed;
  return (
    <>
      {variant === "banner" ? (
        // The empty conversation, once « Faire connaissance » is done (Leslie, 31/10 then 02/11): only the
        // points left, in one line. The three key commands run behind plain words.
        <div className={cn("mx-auto flex w-full max-w-3xl flex-col items-center gap-2.5", className)}>
          {(() => {
              const left = pointsLeft(jz);
              const first = left[0] ? FIX[left[0].id] : null;
              const ready = pronoun === "il" ? "prêt" : "prête";
              return (
                <div className="flex w-full flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/25 dark:bg-amber-500/10 sm:flex-nowrap">
                  <span className="min-w-0 flex-1">
                    <b className="block text-sm text-ink">
                      {left.length <= 1 ? `Un dernier point pour que ${expertName} soit ${ready}` : `${left.length} points pour que ${expertName} soit ${ready}`}
                    </b>
                    <span className="block text-xs text-ink-2">{first?.text ?? "Sa préparation n’est pas encore terminée."}</span>
                  </span>
                  {left.length <= 1 && first?.action ? (
                    <Link
                      href={first.action.href}
                      className="inline-flex h-10 w-full shrink-0 items-center justify-center rounded-xl bg-brand px-4 text-sm font-semibold text-on-brand hover:opacity-90 sm:w-auto"
                    >
                      {left[0]?.id === "outils" ? "Connecter" : first.action.label}
                    </Link>
                  ) : left.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setOpen(true)}
                      className="inline-flex h-10 w-full shrink-0 items-center justify-center rounded-xl bg-brand px-4 text-sm font-semibold text-on-brand hover:opacity-90 sm:w-auto"
                    >
                      Voir les points
                    </button>
                  ) : null}
                </div>
              );
            })()}
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => onCommand?.("/memoire")}
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[13px] font-semibold text-ink-2 hover:bg-soft"
            >
              <BookOpen className="size-4" /> {pronoun === "il" ? "Ce qu’il sait" : "Ce qu’elle sait"}
            </button>
            <button
              type="button"
              onClick={() => onCommand?.("/configuration")}
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[13px] font-semibold text-ink-2 hover:bg-soft"
            >
              <Plug className="size-4" /> Ses outils
            </button>
          </div>
        </div>
      ) : variant === "dot" ? (
        // The icon alone, on every screen (Leslie, 03/11: « une bulle ne suffit-elle pas ? », then option B).
        // Its word shows on hover and is read aloud; a click still opens the preparation.
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={r.label}
          aria-label={`${r.label} : voir sa préparation`}
          className={cn("grid size-6 shrink-0 place-items-center rounded-full hover:bg-soft", className)}
        >
          <StateIcon state={r.state} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Voir sa préparation"
          className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold", TONE[r.state], className)}
        >
          <Icon className="size-3.5" /> {r.label}
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Préparation de {expertName}</DialogTitle>
            <DialogDescription>
              {r.state === "absent"
                ? `${expertName} n’a pas encore fait sa préparation du premier jour.`
                : `Vérifiée${jz.date ? ` le ${new Date(jz.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}` : ""}. ${pronoun === "il" ? "Il" : "Elle"} se revérifie dès qu’un point est réglé.`}
            </DialogDescription>
          </DialogHeader>
          {jz.checks.length > 0 &&
            (() => {
              const left = pointsLeft(jz);
              const ready = pronoun === "il" ? "prêt" : "prête";
              return (
                <div className="flex flex-col gap-3">
                  {left.length > 0 && (
                    <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-ink dark:border-amber-500/25 dark:bg-amber-500/10">
                      {left.length === 1 ? "1 point à régler" : `${left.length} points à régler`} pour que {expertName} soit {ready}
                    </p>
                  )}
                  <div className="flex gap-1" aria-hidden>
                    {jz.checks.map((c) => (
                      <i key={c.id} className={cn("h-1.5 flex-1 rounded-full", c.ok ? "bg-emerald-500" : "bg-soft")} />
                    ))}
                  </div>
                  <ul className="flex flex-col gap-3">
                    {left.map((c) => (
                      <li key={c.id} className="flex gap-2.5">
                        <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full", TONE.partial)}>
                          <X className="size-3" />
                        </span>
                        <div className="min-w-0 flex-1 text-sm">
                          <p className="font-semibold text-ink">{c.label}</p>
                          {c.detail && <p className="text-ink-3">{c.detail}</p>}
                          <div className="mt-1.5 rounded-xl bg-soft px-3 py-2.5">
                            <p className="text-[11px] font-bold tracking-wide text-ink-3">POUR RÉGLER</p>
                            <p className="mt-0.5 text-ink">{FIX[c.id].text}</p>
                            {FIX[c.id].action && (
                              <Link
                                href={FIX[c.id].action!.href}
                                onClick={() => setOpen(false)}
                                className="mt-2 inline-flex h-9 items-center rounded-lg bg-brand px-3 text-[13px] font-semibold text-on-brand hover:opacity-90"
                              >
                                {FIX[c.id].action!.label}
                              </Link>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                    {jz.checks
                      .filter((c) => c.ok)
                      .map((c) => (
                        <li key={c.id} className="flex items-baseline gap-2.5 text-sm">
                          <span className={cn("grid size-5 shrink-0 translate-y-1 place-items-center rounded-full", TONE.ready)}>
                            <Check className="size-3" />
                          </span>
                          <span className="min-w-0">
                            <b className="font-semibold text-ink">{c.label}</b> {c.detail && <span className="text-ink-3">{c.detail}</span>}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              );
            })()}
        </DialogContent>
      </Dialog>
    </>
  );
}
