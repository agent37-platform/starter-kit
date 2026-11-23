"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { cached, cachedFetch } from "@/lib/client-cache";
import { isDjeneba } from "@/lib/expert-cycle";
import { stage, type JourZero } from "@/lib/jour-zero";

/**
 * Whether an Expert's installation is still to do: a « 1 » on it in the menu and on its Discussion tab, in place of
 * the old « Faire connaissance » button (Leslie, 23/11; hermes-experts #109: Djénéba briefs each Expert, which then
 * starts its installation in its own thread). Read from its day-zero file, shared with ExpertReadiness: pending while
 * its onboarding has no date. Never for Djénéba, who has « Bien démarrer » in her chat; never when the file is missing.
 */
export function useInstallPending(expert: { agentId: string; profileId: string; catalogueKey?: string | null } | null): boolean {
  const skip = !expert || isDjeneba(expert);
  const key = expert ? `jour-zero:${expert.agentId}:${expert.profileId}` : "";
  const [jz, setJz] = useState<JourZero | null>(() => (skip ? null : (cached<JourZero>(key) ?? null)));
  useEffect(() => {
    if (skip || !expert) return;
    let live = true;
    setJz(cached<JourZero>(key) ?? null);
    cachedFetch(key, () => apiFetch<JourZero>(`/api/agents/${expert.agentId}/experts/${expert.profileId}/jour-zero`), 60_000).then(
      (r) => live && setJz(r),
      () => undefined
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip, key]);
  return !skip && jz !== null && !jz.absent && stage(jz) === "intro";
}
