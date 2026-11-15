"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { Archive, Hash, Link2, MoreHorizontal, Pencil, Pin, PinOff, Plus, RotateCw, Search, Trash2, User, Users, X } from "lucide-react";
import type { Conversation } from "@/lib/buzz-relay";
import { fold } from "@/lib/fold";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ExchangeKind } from "@/components/messaging/NewExchange";

// La colonne des échanges, sur le modèle de celle des conversations d'un Expert : recherche, filtres, groupes
// (Épinglés, Salons, Conversations, Archivés replié) et, par ligne, « … » : renommer, épingler, copier, archiver, supprimer.

type Filter = "all" | "salons" | "direct";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Tout" },
  { id: "salons", label: "Salons" },
  { id: "direct", label: "Directs" },
];

export interface RailProps {
  list: Conversation[] | null;
  open: string | null;
  ready: boolean;
  refreshing: boolean;
  pinned: Set<string>;
  archived: Set<string>;
  nameOf: (c: Conversation) => string;
  isSalon: (c: Conversation) => boolean;
  isUnit: (c: Conversation) => boolean;
  countOf: (c: Conversation) => number;
  onOpen: (id: string) => void;
  onNew: (kind: ExchangeKind) => void;
  onRefresh: () => void;
  onMark: (id: string, kind: "pinned" | "archived", on: boolean) => void;
  onCopy: (c: Conversation) => void;
  onRename: (c: Conversation, nom: string) => Promise<void>;
  onDelete: (c: Conversation) => Promise<void>;
}

export function ExchangeRail(p: RailProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [deleting, setDeleting] = useState<Conversation | null>(null);

  const groups = useMemo(() => {
    const q = fold(query.trim());
    const found = (p.list ?? []).filter((c) => (filter === "all" || (filter === "salons") === p.isSalon(c)) && (!q || fold(p.nameOf(c)).includes(q)));
    const live = found.filter((c) => !p.archived.has(c.id));
    return [
      { label: "Épinglés", items: live.filter((c) => p.pinned.has(c.id)) },
      { label: "Salons", items: live.filter((c) => !p.pinned.has(c.id) && p.isSalon(c)) },
      { label: "Conversations", items: live.filter((c) => !p.pinned.has(c.id) && !p.isSalon(c)) },
    ].filter((g) => g.items.length);
  }, [p, query, filter]);
  const archivedItems = (p.list ?? []).filter((c) => p.archived.has(c.id));

  async function commit(c: Conversation) {
    const nom = draft.trim();
    setEditing(null);
    if (nom && nom !== p.nameOf(c)) await p.onRename(c, nom);
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>, c: Conversation) => {
    if (e.key === "Enter") void commit(c);
    if (e.key === "Escape") setEditing(null);
  };

  function row(c: Conversation) {
    const salon = p.isSalon(c);
    const renamable = salon && !p.isUnit(c);
    if (editing === c.id)
      return (
        <input key={c.id} autoFocus value={draft} maxLength={60} onChange={(e) => setDraft(e.target.value)} onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => onKey(e, c)} onBlur={() => void commit(c)} aria-label="Nom du salon" className="w-full rounded-[10px] bg-soft px-2.5 py-2 text-sm text-ink outline-none ring-1 ring-brand/30" />
      );
    const n = p.countOf(c);
    return (
      <div key={c.id} className="group relative">
        <button
          type="button"
          onClick={() => p.onOpen(c.id)}
          aria-current={p.open === c.id}
          className={cn("flex min-h-11 w-full select-none items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13.5px] transition-colors", p.open === c.id ? "bg-soft-2 font-semibold text-ink" : p.pinned.has(c.id) ? "bg-tint text-ink hover:bg-soft" : "text-ink-2 hover:bg-soft")}
        >
          <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", salon ? "bg-tint text-brand" : "bg-soft-2 text-ink-2")}>
            {p.isUnit(c) ? <Users className="h-3.5 w-3.5" /> : salon ? <Hash className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate">{p.nameOf(c)}</span>
            <span className="block truncate text-[11.5px] font-normal text-ink-3">{p.isUnit(c) ? "Salon d’équipe" : salon ? "Salon" : "Direct"} · {n} participant{n > 1 ? "s" : ""}</span>
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="Actions" title="Renommer, épingler, copier le lien ou archiver" className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-ink-3 opacity-0 hover:bg-surface hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100">
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 p-1.5">
            {renamable && (
              <DropdownMenuItem onSelect={() => { setDraft(p.nameOf(c)); setEditing(c.id); }} className="gap-2.5 rounded-[10px] px-2.5 py-2 text-sm">
                <Pencil className="size-4" /> Renommer
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => p.onMark(c.id, "pinned", !p.pinned.has(c.id))} className="gap-2.5 rounded-[10px] px-2.5 py-2 text-sm">
              {p.pinned.has(c.id) ? <><PinOff className="size-4" /> Désépingler</> : <><Pin className="size-4" /> Épingler</>}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => p.onCopy(c)} className="gap-2.5 rounded-[10px] px-2.5 py-2 text-sm">
              <Link2 className="size-4" /> Copier le lien
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => p.onMark(c.id, "archived", !p.archived.has(c.id))} className="gap-2.5 rounded-[10px] px-2.5 py-2 text-sm">
              <Archive className="size-4" /> {p.archived.has(c.id) ? "Désarchiver" : "Archiver"}
            </DropdownMenuItem>
            {renamable && (
              <DropdownMenuItem onSelect={() => setDeleting(c)} className="gap-2.5 rounded-[10px] px-2.5 py-2 text-sm text-ko">
                <Trash2 className="size-4" /> Supprimer
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-2.5 pb-2 pt-1">
        <span className="text-[15px] font-bold text-ink">
          Échanges{p.list && p.list.length > 0 && <span className="ml-1 font-semibold tabular-nums text-ink-3">({p.list.length})</span>}
        </span>
        <button type="button" onClick={p.onRefresh} disabled={!p.ready || p.refreshing} aria-label="Actualiser" title="Actualiser" className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-soft hover:text-ink disabled:opacity-60">
          <RotateCw className={cn("h-4 w-4", p.refreshing && "animate-spin")} />
        </button>
      </div>
      <div className="mx-1 mb-2.5 grid grid-cols-2 gap-1.5">
        <button type="button" disabled={!p.ready} onClick={() => p.onNew("message")} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[10px] border border-brand/60 bg-surface text-[13px] font-semibold text-brand-ink transition-colors hover:bg-tint disabled:opacity-60">
          <Plus className="h-4 w-4" /> Message
        </button>
        <button type="button" disabled={!p.ready} onClick={() => p.onNew("salon")} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[10px] border border-line bg-surface text-[13px] font-semibold text-ink-2 transition-colors hover:bg-soft disabled:opacity-60">
          <Hash className="h-4 w-4" /> Salon
        </button>
      </div>
      <label className="relative mx-1 mb-2 block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chercher" aria-label="Rechercher un échange" className="h-9 w-full rounded-[10px] border border-line bg-soft pl-8 pr-8 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-brand/40 focus:bg-surface [&::-webkit-search-cancel-button]:hidden" />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="Effacer la recherche" className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-ink-3 hover:text-ink">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </label>
      <div role="group" aria-label="Filtrer les échanges" className="mx-1 mb-2.5 grid grid-cols-3 gap-0.5 rounded-xl bg-soft p-[3px]">
        {FILTERS.map(({ id, label }) => (
          <button key={id} type="button" onClick={() => setFilter(id)} aria-pressed={filter === id} className={cn("inline-flex h-8 items-center justify-center rounded-[9px] px-2 text-[12.5px] font-semibold transition-colors", filter === id ? "bg-surface text-brand-ink shadow-[0_1px_3px_rgba(20,10,60,0.12)]" : "text-ink-2 hover:text-ink")}>
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={p.list === null}>
        {p.list === null && [1, 2, 3].map((n) => <div key={n} className="mx-1 mb-1.5 h-11 animate-pulse rounded-[10px] bg-soft" />)}
        {p.list?.length === 0 && <p className="px-2.5 py-3 text-xs text-ink-3">Aucun échange. « Message » écrit à quelqu’un ou à ses Experts ; « Salon » ouvre un espace nommé à plusieurs.</p>}
        {groups.map((g) => (
          <div key={g.label} className="mb-2">
            <div className="px-2.5 pb-1 pt-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">{g.label}</div>
            {g.items.map(row)}
          </div>
        ))}
        {archivedItems.length > 0 && (
          <div className="mb-2">
            <button type="button" onClick={() => setShowArchived((v) => !v)} className="px-2.5 pb-1 pt-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3 hover:text-ink">
              Archivés ({archivedItems.length}) {showArchived ? "▾" : "▸"}
            </button>
            {showArchived && archivedItems.map(row)}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Supprimer le salon ?"
        description={deleting ? `« ${p.nameOf(deleting)} » et ses messages seront supprimés pour tous ses participants. Les livrables de ses Experts restent dans Livrables. Cette action est définitive.` : undefined}
        confirmText="Supprimer"
        destructive
        onConfirm={async () => {
          if (deleting) await p.onDelete(deleting);
        }}
      />
    </div>
  );
}
