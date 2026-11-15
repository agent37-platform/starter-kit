"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArchiveRestore, CheckCheck, Lock, Pin, Repeat, Search } from "lucide-react";
import { useExpertsContext } from "@/components/experts/ExpertsProvider";
import { ExpertAvatar } from "@/components/experts/ExpertAvatar";
import { useNotifications } from "@/components/activity/ActivityProvider";
import { Picker } from "@/components/ui/picker";
import { cn } from "@/lib/utils";
import { convKey } from "@/lib/activity";
import { arrange } from "@/lib/chat-marks";
import { fold, useAllConversations, useOwnAgentId, type ConversationRow } from "./useAllConversations";
import { useChatMarks } from "./useChatMarks";
import type { ChatSession } from "@/components/chat/types";

type Filter = "tout" | "non-lues" | "routines" | "archivees";
const DAY = 86_400_000;
const DATES = [
  { value: "", label: "Toutes les dates" },
  { value: "1", label: "Aujourd’hui" },
  { value: "7", label: "7 derniers jours" },
  { value: "30", label: "30 derniers jours" },
];

// The period a conversation falls in, from today's midnight.
function period(at: number): string {
  const midnight = new Date().setHours(0, 0, 0, 0);
  if (at >= midnight) return "Aujourd’hui";
  if (at >= midnight - DAY) return "Hier";
  if (at >= midnight - 6 * DAY) return "Cette semaine";
  if (at >= midnight - 29 * DAY) return "Ce mois-ci";
  return "Plus ancien";
}

const time = (at: number) =>
  at >= new Date().setHours(0, 0, 0, 0)
    ? new Date(at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : new Date(at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

// Toutes les conversations: the chat d'entreprise's and every Expert's in one list, by period,
// with a search, Tout / Non lues / Routines / Archivées, the Expert and the dates. Pinned ones head
// the list; archived ones only show under « Archivées », where they can be brought back. A row opens
// the conversation in its space; « Tout marquer comme lu » clears the bell's marks.
export function AllConversations({ initial = null }: { initial?: Record<string, ChatSession[]> | null }) {
  const ownAgentId = useOwnAgentId();
  const { experts } = useExpertsContext();
  const rows = useAllConversations(ownAgentId, experts, true, initial);
  const bell = useNotifications();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("tout");
  const [who, setWho] = useState("");
  const [since, setSince] = useState("");
  const { marks, mark } = useChatMarks();
  const keyOf = (r: ConversationRow) => convKey(r.expert?.agentId ?? ownAgentId ?? "", r.expert?.profileId ?? null, r.session.session_id);
  const archivedKeys = new Set(marks.archived);

  const unreadIds = useMemo(() => new Set(bell.items.filter((i) => i.unread).map((i) => i.sessionId)), [bell.items]);
  const needle = fold(q.trim());
  const shown = useMemo(() => {
    const from = since ? new Date().setHours(0, 0, 0, 0) - (Number(since) - 1) * DAY : 0;
    return (rows ?? []).filter(
      (r) =>
        (!needle || fold(r.session.routine ?? r.session.title ?? "").includes(needle)) &&
        (filter !== "non-lues" || unreadIds.has(r.session.session_id)) &&
        (filter !== "routines" || Boolean(r.session.routine)) &&
        (!who || (who === "entreprise" ? r.expert === null : r.expert?.profileId === who)) &&
        r.at >= from &&
        (filter === "archivees") === archivedKeys.has(keyOf(r))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, needle, filter, unreadIds, who, since, marks, ownAgentId]);
  const pinnedKeys = new Set(marks.pinned);
  const groups = useMemo(() => {
    // `shown` is already split between archived and not: only the pins matter here.
    const { pinned, rest } = arrange(shown, keyOf, { ...marks, archived: [] });
    const out: { label: string; rows: ConversationRow[] }[] = pinned.length ? [{ label: "Épinglées", rows: pinned }] : [];
    for (const r of rest) {
      const label = period(r.at);
      const last = out.at(-1);
      if (last?.label === label) last.rows.push(r);
      else out.push({ label, rows: [r] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, marks]);

  const chips: { id: Filter; label: string }[] = [
    { id: "tout", label: "Tout" },
    { id: "non-lues", label: unreadIds.size ? `Non lues ${unreadIds.size}` : "Non lues" },
    { id: "routines", label: "Routines" },
    { id: "archivees", label: "Archivées" },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-[30px] font-bold tracking-tight text-ink">Toutes les conversations</h1>
        {unreadIds.size > 0 && (
          <button type="button" onClick={bell.markAllRead} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-ink-2 hover:bg-soft">
            <CheckCheck className="size-4" /> Tout marquer comme lu
          </button>
        )}
      </div>

      <label className="mt-5 flex h-11 items-center gap-2.5 rounded-xl border border-line bg-surface px-3">
        <Search className="size-4 shrink-0 text-ink-3" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher une conversation"
          className="w-full bg-transparent text-[15px] text-ink placeholder:text-ink-3 focus:outline-none"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setFilter(c.id)}
            aria-pressed={filter === c.id}
            className={cn(
              "h-9 rounded-full px-3.5 text-[13px] font-semibold transition-colors",
              filter === c.id ? "bg-ink text-surface" : "bg-soft text-ink-2 hover:bg-soft-2"
            )}
          >
            {c.label}
          </button>
        ))}
        <span className="ml-auto flex flex-wrap gap-2">
          <Picker
            label="Expert"
            placeholder="Tous les Experts"
            value={who}
            onChange={setWho}
            groups={[
              {
                options: [
                  { value: "", label: "Tous les Experts" },
                  { value: "entreprise", label: "Chat d’entreprise" },
                  ...experts.map((e) => ({ value: e.profileId, label: e.displayName })),
                ],
              },
            ]}
          />
          <Picker label="Dates" placeholder="Toutes les dates" value={since} onChange={setSince} groups={[{ options: DATES }]} />
        </span>
      </div>

      {rows === null ? (
        <p className="mt-8 text-sm text-ink-3">Chargement des conversations…</p>
      ) : groups.length === 0 ? (
        <p className="mt-8 text-sm text-ink-3">{filter === "archivees" && !needle ? "Aucune conversation archivée." : "Aucune conversation ne correspond."}</p>
      ) : (
        groups.map((g) => (
          <section key={g.label} className="mt-6">
            <h2 className="flex items-center justify-between px-1 pb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">
              {g.label}
              <span className="font-medium normal-case">{g.rows.length}</span>
            </h2>
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              {g.rows.map((r) => {
                const unread = unreadIds.has(r.session.session_id);
                const key = keyOf(r);
                return (
                  <div key={r.href} className="flex items-center border-b border-line last:border-b-0 hover:bg-soft">
                  <Link href={r.href} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2.5">
                    {r.expert ? (
                      <ExpertAvatar expert={{ ...r.expert, gateway: null }} size="sm" />
                    ) : (
                      <span className="grid size-[34px] shrink-0 place-items-center rounded-full bg-tint text-brand-ink">
                        <Lock className="size-4" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className={cn("flex items-center gap-1.5 truncate text-sm text-ink", unread ? "font-bold" : "font-semibold")}>
                        {r.session.routine && <Repeat className="size-3.5 shrink-0 text-ink-3" />}
                        <span className="truncate">{r.session.routine ?? (r.session.title || "Nouvelle conversation")}</span>
                      </span>
                      <span className="block truncate text-xs text-ink-3">{r.expert ? r.expert.displayName : "Chat d’entreprise"}</span>
                    </span>
                    {unread && <span className="size-2.5 shrink-0 rounded-full bg-brand" aria-label="Non lue" />}
                    {pinnedKeys.has(key) && <Pin className="size-3.5 shrink-0 text-ink-3" aria-label="Épinglée" />}
                    <span className="shrink-0 text-xs text-ink-3">{time(r.at)}</span>
                  </Link>
                  {archivedKeys.has(key) && (
                    <button
                      type="button"
                      onClick={() => mark(key, "archived", false)}
                      className="mr-3 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] font-semibold text-ink-2 hover:text-ink"
                    >
                      <ArchiveRestore className="size-4" /> Désarchiver
                    </button>
                  )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
