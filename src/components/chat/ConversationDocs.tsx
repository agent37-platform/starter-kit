"use client";

import { useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Pencil, Pin, Search } from "lucide-react";
import type { TurnDoc } from "@/lib/drive-links";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FilePreview } from "@/components/files/FilePreview";
import { DOC_TONE } from "@/components/files/preview-siblings";
import type { FileEntry } from "@/components/files/types";
import { cn } from "@/lib/utils";
import { GOOGLE_LABEL, SHORT_LABEL, dayHeading, docName, foldName, isUnnamed, usedTime, type GoogleDoc } from "@/lib/google-docs";
import { GoogleTile, useDocNames, usePins } from "./GoogleDocs";

const TONE = DOC_TONE;

const ext = (name: string) => (name.includes(".") ? name.split(".").pop()!.slice(0, 4).toUpperCase() : "FICH");

function modifiedLabel(ms: number | null): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? `Modifié à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
    : `Modifié le ${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;
}

// A row the pointer passes over takes no focus: it would pull it from the search or the name being typed.
const noHoverFocus = {
  onPointerMove: (e: { preventDefault: () => void }) => e.preventDefault(),
  onPointerLeave: (e: { preventDefault: () => void }) => e.preventDefault(),
};

// The deliverables this discussion produced (Leslie, 28/10): a button in the chat's bar, the Google
// documents it uses first (31/10, opened in Google), then the files in a list, each opened in place,
// then the whole folder in Livrables. Each Google document under its name (the member may rename it), the
// time it was last used, grouped by day, and a search past a few (Leslie, 18/11).
export function ConversationDocs({
  agentId,
  docs,
  google = [],
  folderHref,
}: {
  agentId: string;
  docs: TurnDoc[];
  google?: (GoogleDoc & { usedAt: number | null })[];
  folderHref: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<FileEntry | null>(null);
  // The punaise of a row pins that document above the conversation (Leslie, 03/11): one at a time, the
  // last used by default.
  const pins = usePins();
  const pinnedId = google.find((g) => pins?.pinned.includes(g.id))?.id ?? google[0]?.id ?? null;
  const { names, rename } = useDocNames();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  if (!docs.length && !google.length) return null;
  const total = docs.length + google.length;
  const q = foldName(query.trim());
  const shownGoogle = q ? google.filter((g) => foldName(docName(g, names)).includes(q)) : google;
  const shownDocs = q ? docs.filter((d) => foldName(d.name).includes(q)) : docs;
  const startEdit = (g: GoogleDoc) => {
    setEditing(g.id);
    setDraft(names[g.id] ?? (isUnnamed(g) ? "" : g.title));
  };
  const save = () => {
    if (editing) rename(editing, draft);
    setEditing(null);
  };
  // Typing in the menu must not jump between its rows (the menu's own type-ahead).
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") save();
    if (e.key === "Escape") {
      e.preventDefault();
      setEditing(null);
    }
  };
  let lastDay: string | null = null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title="Livrables de cette discussion"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-tint px-3 text-[13px] font-semibold text-brand-ink hover:bg-soft-2"
          >
            <FolderOpen className="h-4 w-4" />
            <span className="max-sm:hidden">Livrables</span>
            <span className="grid min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] leading-5 text-on-brand tabular-nums">{docs.length + google.length}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="max-h-[min(36rem,calc(100dvh-7rem))] w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto p-1.5"
          onCloseAutoFocus={() => {
            setEditing(null);
            setQuery("");
          }}
        >
          <DropdownMenuLabel className="text-[12.5px] font-semibold text-ink-2">Livrables de cette discussion</DropdownMenuLabel>
          {total > 8 && (
            <label className="mx-1 mb-1 flex h-9 items-center gap-2 rounded-lg bg-soft px-2.5 text-ink-3">
              <Search className="size-4 shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder={`Chercher parmi les ${total}`}
                aria-label="Chercher un livrable"
                className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-3"
              />
            </label>
          )}
          {shownGoogle.map((g) => {
            const isPinned = g.id === pinnedId;
            const title = docName(g, names);
            const unnamed = !names[g.id] && isUnnamed(g);
            const day = dayHeading(g.usedAt);
            const heading = day !== lastDay ? day : null;
            lastDay = day;
            const time = usedTime(g.usedAt);
            return (
              <div key={g.id}>
                {heading && <p className="px-2 pb-1 pt-2.5 text-[11.5px] font-bold text-ink-3">{heading}</p>}
                {editing === g.id ? (
                  <div className="flex items-center gap-1.5 rounded-lg bg-soft p-1.5 pl-2">
                    <GoogleTile kind={g.kind} className="size-8 rounded-md" />
                    <input
                      autoFocus
                      onFocus={(e) => e.currentTarget.select()}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={keys}
                      maxLength={120}
                      placeholder="Nom du document"
                      aria-label={`Nouveau nom pour ${title}`}
                      className="h-9 min-w-0 flex-1 rounded-lg border-[1.5px] border-brand bg-surface px-2.5 text-[13.5px] font-medium text-ink outline-none"
                    />
                    <button type="button" onClick={save} className="h-9 shrink-0 rounded-lg bg-brand px-3 text-[13px] font-semibold text-on-brand">
                      OK
                    </button>
                  </div>
                ) : (
                  <div className="group flex items-center gap-1">
                    <DropdownMenuItem asChild {...noHoverFocus} className="min-w-0 flex-1 gap-2.5 rounded-lg py-2 hover:bg-soft">
                      <a href={g.url} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir ${title} dans ${GOOGLE_LABEL[g.kind]}`}>
                        <GoogleTile kind={g.kind} className="size-8 rounded-md" />
                        <span className="min-w-0 grow">
                          <span title={title} className={cn("block truncate text-[13.5px] font-medium", unnamed ? "italic text-ink-3" : "text-ink")}>
                            {title}
                          </span>
                          <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
                            {SHORT_LABEL[g.kind]}
                            {time && `, ${time}`}
                            {isPinned && pins && google.length > 1 && (
                              <span className="rounded-full bg-tint px-1.5 text-[11px] font-semibold leading-[18px] text-brand-ink">Épinglé</span>
                            )}
                          </span>
                        </span>
                      </a>
                    </DropdownMenuItem>
                    {unnamed ? (
                      <button
                        type="button"
                        onClick={() => startEdit(g)}
                        className="h-8 shrink-0 rounded-lg bg-tint px-2.5 text-[12.5px] font-semibold text-brand-ink hover:bg-soft-2"
                      >
                        Nommer
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(g)}
                        title="Renommer"
                        aria-label={`Renommer ${title}`}
                        className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-soft hover:text-ink focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                      >
                        <Pencil className="size-4" />
                      </button>
                    )}
                    {pins && google.length > 1 && (
                      <button
                        type="button"
                        onClick={() => pins.toggle(g.id)}
                        aria-pressed={isPinned}
                        title={isPinned ? "Épinglé en haut de la discussion" : "Épingler en haut de la discussion"}
                        aria-label={isPinned ? `${title} est épinglé en haut de la discussion` : `Épingler ${title} en haut de la discussion`}
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-lg",
                          isPinned ? "bg-tint text-brand-ink" : "text-ink-3 hover:bg-soft hover:text-ink"
                        )}
                      >
                        <Pin className={cn("size-4", isPinned && "fill-current")} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {q && !shownGoogle.length && !shownDocs.length && <p className="px-2 py-3 text-[13px] text-ink-3">Aucun livrable ne porte ce nom.</p>}
          {shownDocs.length > 0 && shownGoogle.length > 0 && <DropdownMenuSeparator />}
          {shownDocs.map((d) => (
            <DropdownMenuItem
              key={d.path}
              {...noHoverFocus}
              onSelect={() => setOpen({ name: d.name, path: d.path, type: "file", size: d.size, modified: d.modified ?? 0, hidden: false })}
              className="gap-2.5 rounded-lg py-2 hover:bg-soft"
            >
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-md text-[9.5px] font-bold text-white", TONE[d.kind])}>{ext(d.name)}</span>
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-medium text-ink">{d.name}</span>
                {modifiedLabel(d.modified) && <span className="block text-[12px] text-ink-3">{modifiedLabel(d.modified)}</span>}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => router.push(folderHref)} className="rounded-lg py-2 text-[13.5px] font-semibold text-brand-ink">
            Ouvrir dans Livrables
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FilePreview agentId={agentId} entry={open} onClose={() => setOpen(null)} />
    </>
  );
}
