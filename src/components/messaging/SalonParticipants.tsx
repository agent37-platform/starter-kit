"use client";

import { useMemo } from "react";
import { salonPeople, shortName, type BuzzEntry } from "@/lib/buzz";
import { ParticipantAvatar } from "@/components/messaging/ParticipantAvatar";

// L'onglet « Participants » d'un salon : chaque personne, puis ses Experts présents ; vous en tête.
export function SalonParticipants({ members, directory, mine }: { members: string[]; directory: BuzzEntry[]; mine: string[] }) {
  const groups = useMemo(() => salonPeople(directory, members, mine), [directory, members, mine]);
  const count = groups.reduce((n, g) => n + (g.person ? 1 : 0) + g.experts.length, 0);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <p className="text-[13px] text-ink-3">{count} participant{count > 1 ? "s" : ""}</p>
      {groups.length === 0 && <p className="mt-3 text-sm text-ink-3">Personne d’autre n’est encore dans ce salon.</p>}
      <ul className="mt-3 space-y-3">
        {groups.map((g) => (
          <li key={g.membre} className="rounded-xl border border-line bg-surface p-3">
            <div className="flex items-center gap-2.5">
              <ParticipantAvatar entry={g.person} name={g.nom} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{g.nom}</span>
              <span className="shrink-0 text-xs text-ink-3">{g.self ? "Vous" : g.person ? "Personne" : "Ses Experts seulement"}</span>
            </div>
            {g.experts.length > 0 && (
              <ul className="mt-2 space-y-1.5 border-t border-line pl-1 pt-2">
                {g.experts.map((e) => (
                  <li key={e.cles[0]} className="flex items-center gap-2.5">
                    <ParticipantAvatar entry={e} name={e.nom} size="xs" />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{shortName(e.nom)}</span>
                    <span className="shrink-0 text-xs text-ink-3">{g.self ? "Votre Expert" : "Expert"}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
