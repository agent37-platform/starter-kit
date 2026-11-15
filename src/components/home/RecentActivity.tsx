"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, FileText, Folder, Lock, MessageSquare } from "lucide-react";
import { ExpertAvatar } from "@/components/experts/ExpertAvatar";
import { CyclePill } from "@/components/experts/ExpertItem";
import { useExpertsContext } from "@/components/experts/ExpertsProvider";
import { useCompanySessions } from "@/components/conversations/useCompanySessions";
import { formatMtime, type FileEntry } from "@/components/files/types";
import { isNew, markSeen, useAllDeliverables, type Deliverable } from "@/components/files/useAllDeliverables";
import { agentTabPath } from "@/lib/expert-tabs";
import { expertCycle, isDjeneba } from "@/lib/expert-cycle";
import { relativeFr } from "@/lib/fr-dates";
import { toMs } from "@/lib/activity";
import { cn } from "@/lib/utils";

// Loaded on a click only: the preview carries the markdown renderer.
const FilePreview = dynamic(() => import("@/components/files/FilePreview").then((m) => m.FilePreview), { ssr: false });

const KEY = "yelema.accueil-activite";

// Under the home's chat bar, folded by default (Myriel, Leslie 30/10): the latest deliverables with
// the Expert who made each, the team, and the chat d'entreprise's latest conversations. Opened or
// folded, the choice is kept in this browser; folded when the browser keeps nothing.
export function RecentActivity({ agentId }: { agentId: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(KEY) === "1");
    } catch {}
  }, []);
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(KEY, o ? "0" : "1");
      } catch {}
      return !o;
    });

  return (
    <section className="mt-8">
      <div className="flex justify-center">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={id}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-ink-3 hover:bg-soft hover:text-ink"
        >
          {open ? "Masquer l’activité récente" : "Afficher l’activité récente"}
          <ChevronDown className={cn("size-4 transition-transform duration-200", open && "rotate-180")} />
        </button>
      </div>
      <div id={id} hidden={!open} className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1">
        {open && <Activity agentId={agentId} />}
      </div>
    </section>
  );
}

function Activity({ agentId }: { agentId: string }) {
  const { experts } = useExpertsContext();
  const all = useAllDeliverables(agentId, experts);
  const sessions = useCompanySessions(agentId).slice(0, 3);
  const [preview, setPreview] = useState<{ agentId: string; entry: FileEntry } | null>(null);
  const team = [...experts].sort((a, b) => Number(isDjeneba(b)) - Number(isDjeneba(a)));

  const openFile = (d: Deliverable) => {
    markSeen(d);
    setPreview({ agentId: d.agentId, entry: { name: d.name, path: d.path, type: "file", size: null, modified: d.modified } as FileEntry });
  };

  return (
    <div className="mt-4 flex flex-col gap-8">
      <div>
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="font-display text-lg font-bold text-ink">Derniers livrables</h2>
          <Link href="/livrables" className="inline-flex min-h-10 items-center gap-1 text-[13px] font-semibold text-brand-ink hover:underline">
            Voir tous les livrables <ArrowRight className="size-4" />
          </Link>
        </div>
        {all === null ? (
          <p className="mt-3 px-1 text-sm text-ink-3">Chargement…</p>
        ) : all.length === 0 ? (
          <p className="mt-3 flex items-center gap-2 px-1 text-sm text-ink-3">
            <Folder className="size-4" /> Les livrables de vos Experts apparaîtront ici.
          </p>
        ) : (
          <ul className="mt-2.5 overflow-hidden rounded-card border border-line bg-surface">
            {all.slice(0, 3).map((d) => {
              const row = (
                <>
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-tint text-brand-ink">
                    {d.folder ? <Folder className="size-5" /> : <FileText className="size-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink">{d.name}</span>
                      {isNew(d) && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-tint px-2 py-0.5 text-[11px] font-semibold text-brand-ink">
                          <span className="size-1.5 rounded-full bg-brand" aria-hidden /> Nouveau
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-ink-3">
                      {d.files === 1 ? "1 fichier" : `${d.files} fichiers`} · {formatMtime(d.modified)}
                      {/* On a phone the Expert comes under the line. */}
                      <span className="sm:hidden"> · {d.expert?.displayName ?? "Chat d’entreprise"}</span>
                    </span>
                  </span>
                  <span className="hidden w-40 shrink-0 items-center gap-2 text-sm text-ink-2 sm:flex">
                    {d.expert ? (
                      <ExpertAvatar expert={{ ...d.expert, gateway: null }} size="xs" />
                    ) : (
                      <span className="grid size-7 place-items-center rounded-full bg-tint text-brand-ink">
                        <Lock className="size-3.5" />
                      </span>
                    )}
                    <span className="truncate">{d.expert?.displayName ?? "Chat d’entreprise"}</span>
                  </span>
                </>
              );
              const cls = "flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-soft";
              return (
                <li key={`${d.agentId}:${d.path}`} className="border-b border-line last:border-0">
                  {d.folder ? (
                    <Link href={d.href} onClick={() => markSeen(d)} className={cls}>
                      {row}
                    </Link>
                  ) : (
                    <button type="button" onClick={() => openFile(d)} className={cls}>
                      {row}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {team.length > 0 && (
        <div>
          <h2 className="px-1 font-display text-lg font-bold text-ink">Vos Experts</h2>
          <ul className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {team.map((e) => {
              const cycle = expertCycle(e);
              return (
                <li key={`${e.agentId}:${e.profileId}`}>
                  <Link
                    href={agentTabPath(e.agentId, "chat", e.profileId)}
                    className="flex min-h-16 items-center gap-3 rounded-card border border-line bg-surface p-3 hover:bg-soft"
                  >
                    <ExpertAvatar expert={{ ...e, gateway: null }} size="md" />
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-ink">{e.displayName}</span>
                        {cycle && <CyclePill name={cycle.name} />}
                      </span>
                      <span className="block truncate text-xs text-ink-3">{e.title ?? e.role ?? ""}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {sessions.length > 0 && (
        <div>
          <h2 className="px-1 font-display text-lg font-bold text-ink">Reprendre</h2>
          <ul className="mt-2.5 overflow-hidden rounded-card border border-line bg-surface">
            {sessions.map((s) => (
              <li key={s.session_id} className="border-b border-line last:border-0">
                <Link
                  href={`${agentTabPath(agentId, "chat")}?session=${encodeURIComponent(s.session_id)}`}
                  className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-soft"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-tint text-brand-ink">
                    <MessageSquare className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{s.title || "Nouvelle conversation"}</span>
                  <span className="shrink-0 text-xs text-ink-3">{relativeFr(toMs(s.last_active))}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview && <FilePreview agentId={preview.agentId} entry={preview.entry} onClose={() => setPreview(null)} />}
    </div>
  );
}
