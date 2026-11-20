"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, CircleDashed, Clock3, Moon, Repeat, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExpertAvatar } from "@/components/experts/ExpertAvatar";
import { useExpertsContext } from "@/components/experts/ExpertsProvider";
import { apiFetch } from "@/lib/api";
import { agentTabPath } from "@/lib/expert-tabs";
import { nightCounts, nightStart, nightSummary, type NightItem, type NightState } from "@/lib/nuit";
import type { Expert } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * « Cette nuit » (Leslie, 20/11 : « le matin tu es déçue car il n'a rien fait ») : le matin, une bande fine sous la
 * barre du haut dit ce que les Experts ont fait depuis la veille à 18 h ; « Voir » ouvre le bilan, Expert par Expert :
 * fait, bloqué (et pourquoi), pas parti, en cours. Fermée, elle ne revient que le lendemain.
 */
const SEEN_KEY = "yelema-nuit-vue";
// The morning: from 5 h to 14 h (Abidjan, UTC all year).
const MORNING = (now: number) => {
  const h = new Date(now).getUTCHours();
  return h >= 5 && h < 14;
};

const STATE: Record<NightState, { label: string; icon: typeof CheckCircle2; tone: string }> = {
  fait: { label: "Fait", icon: CheckCircle2, tone: "text-ok" },
  bloque: { label: "Bloqué", icon: CircleAlert, tone: "text-ko" },
  "pas-parti": { label: "Pas parti", icon: CircleDashed, tone: "text-amber-600 dark:text-amber-400" },
  "en-cours": { label: "En cours", icon: Clock3, tone: "text-ink-3" },
};
const ORDER: NightState[] = ["bloque", "pas-parti", "en-cours", "fait"];

type Night = { expert: Expert; items: NightItem[] }[];

export function useNight(experts: Expert[], enabled: boolean): Night | null {
  const [night, setNight] = useState<Night | null>(null);
  const key = experts.map((e) => `${e.agentId}/${e.profileId}`).join(",");
  useEffect(() => {
    if (!enabled || !experts.length) return;
    let off = false;
    const byAgent = new Map<string, Expert[]>();
    for (const e of experts) byAgent.set(e.agentId, [...(byAgent.get(e.agentId) ?? []), e]);
    Promise.all(
      [...byAgent].map(([agentId, list]) =>
        apiFetch<{ experts: Record<string, NightItem[]> }>(`/api/agents/${agentId}/nuit?profiles=${encodeURIComponent(list.map((e) => e.profileId).join(","))}`)
          .then((r) => list.map((e) => ({ expert: e, items: r.experts[e.profileId] ?? [] })))
          .catch(() => [])
      )
    ).then((all) => !off && setNight(all.flat().filter((n) => n.items.length)));
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return night;
}

export function NightStrip() {
  const { experts } = useExpertsContext();
  const [now] = useState(() => Date.now());
  const night0 = String(nightStart(now));
  const [hidden, setHidden] = useState(true);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setHidden(!MORNING(now) || localStorage.getItem(SEEN_KEY) === night0);
    } catch {
      setHidden(!MORNING(now));
    }
  }, [now, night0]);
  const night = useNight(experts, !hidden);
  const counts = useMemo(() => nightCounts((night ?? []).flatMap((n) => n.items)), [night]);
  const summary = nightSummary(counts);
  if (hidden || !night || !summary) return null;
  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem(SEEN_KEY, night0);
    } catch {
      // Elle reviendra au prochain chargement.
    }
  };
  const alert = counts.bloque + counts["pas-parti"] > 0;
  return (
    <>
      <div role="status" className={cn("flex items-center gap-2.5 border-b px-4 py-1.5 text-[13px] leading-snug text-ink md:px-8", alert ? "border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10" : "border-line bg-soft")}>
        <Moon className="h-4 w-4 shrink-0 text-brand" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold">Cette nuit</span> : {summary}
        </span>
        <button type="button" onClick={() => setOpen(true)} className="inline-flex h-8 shrink-0 items-center rounded-lg bg-ink px-3 text-[12.5px] font-semibold text-bg hover:opacity-90 pointer-coarse:h-10">
          Voir
        </button>
        <button type="button" onClick={close} aria-label="Fermer jusqu’à demain" title="Fermer jusqu’à demain" className="grid size-8 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-soft hover:text-ink pointer-coarse:size-10">
          <X className="h-4 w-4" />
        </button>
      </div>
      {open && <NightDialog night={night} onClose={() => setOpen(false)} />}
    </>
  );
}

const hour = (at: number | null) => (at ? new Date(at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Abidjan" }).replace(":", " h ") : "");

export function NightDialog({ night, onClose }: { night: Night; onClose: () => void }) {
  const sorted = [...night].sort((a, b) => score(b.items) - score(a.items));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cette nuit</DialogTitle>
          <DialogDescription>Depuis hier 18 h. Les blocages d’abord.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {sorted.map(({ expert, items }) => (
            <section key={`${expert.agentId}/${expert.profileId}`}>
              <h3 className="mb-1.5 flex items-center gap-2.5">
                <ExpertAvatar expert={expert} size="sm" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{expert.displayName}</span>
                  {expert.role && <span className="block truncate text-xs text-ink-3">{expert.role}</span>}
                </span>
              </h3>
              <ul className="space-y-1">
                {[...items].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state)).map((i) => {
                  const S = STATE[i.state];
                  const body = (
                    <>
                      <S.icon className={cn("mt-0.5 h-4 w-4 shrink-0", S.tone)} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="min-w-0 flex-1 text-sm text-ink">
                            {i.kind === "routine" && <Repeat className="mr-1 inline h-3.5 w-3.5 text-ink-3" aria-label="Routine" />}
                            {i.title}
                          </span>
                          <span className={cn("shrink-0 text-xs font-semibold", S.tone)}>
                            {S.label}
                            {i.at ? <span className="font-normal text-ink-3"> · {hour(i.at)}</span> : null}
                          </span>
                        </span>
                        {i.detail && <span className={cn("mt-0.5 block text-xs", i.state === "bloque" ? "text-ko" : "text-ink-3")}>{i.detail}</span>}
                      </span>
                    </>
                  );
                  const href = i.session ? `${agentTabPath(expert.agentId, "chat", expert.profileId)}?session=${encodeURIComponent(i.session)}` : i.kind === "routine" ? agentTabPath(expert.agentId, "routines", expert.profileId) : null;
                  return (
                    <li key={`${i.kind}-${i.id}`}>
                      {href ? (
                        <Link href={href} onClick={onClose} className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-soft">
                          {body}
                        </Link>
                      ) : (
                        <div className="flex items-start gap-2.5 px-2 py-2">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const score = (items: NightItem[]) => items.filter((i) => i.state === "bloque").length * 100 + items.filter((i) => i.state === "pas-parti").length * 10;
