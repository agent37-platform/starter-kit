"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  File as FileIcon,
  Folder,
  FolderInput,
  FolderUp,
  Grid2X2,
  Link2,
  List,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X,
  Upload,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { fileLabel } from "@/lib/drive-paths";
import { DropOverlay } from "@/components/DropOverlay";
import { HiddenFileInput } from "@/components/HiddenFileInput";
import { FilePreview, ReducedImage } from "./FilePreview";
import { Preview as DocPreview } from "@/components/chat/DocumentCards";
import { docKind } from "@/lib/drive-links";
import { driveTree } from "@/lib/drive-store";
import { coverRank, deliverableItems } from "@/lib/deliverable-folders";
import { GoogleGlyph } from "@/components/chat/GoogleDocs";
import { shortcutKind } from "@/lib/google-docs";
import { MoveDialog } from "./MoveDialog";
import { VariantGroups } from "./VariantGroups";
import { groupVariants, isSourceFolder } from "@/lib/visual-variants";
import { ARCHIVE_FOLDER, isArchived, newerVersions, splitVersions, versionOf } from "@/lib/drive-versions";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";
import { useFileBrowser } from "./useFileBrowser";
import { BackButton } from "@/components/ui/back-button";
import { archiveUrl, breadcrumbs, contentUrl, formatBytes, formatMtime, isDir, thumbUrl, type FileEntry } from "./types";

type ViewMode = "list" | "grid";

// The Files pane, rendered full-height in the dashboard main when the Files tab is active (kept
// mounted/hidden across tab switches, like ChatView, so the current directory survives). The whole
// pane is a drop zone for uploads. Look + primitives mirror the Chat tab: same shadcn Dialog/Input,
// lucide icons, sonner toasts (raised inside the hook), and the hover-action pattern.
// A pointer only crossing a folder reads nothing; one resting on it this long reads it ahead.
// What a row of the list carries when dragged, told apart from files dragged in from the computer.
const MOVE_TYPE = "application/x-yelema-path";
const HOVER_INTENT_MS = 150;

export function FilesView({
  agentId,
  initialPath,
  openPath,
  openFile,
  inbox,
  home,
}: {
  agentId: string;
  initialPath?: string;
  openPath?: string | null;
  openFile?: string | null;
  inbox?: string;
  /** The Expert's own folder: its Livrables stop there, nothing above it (Leslie, 16/11: « on est censé être dans les
   * livrables d'un expert, pourquoi est-ce qu'on a tous les experts »). The general page lists everyone's. */
  home?: string;
}) {
  const fb = useFileBrowser(agentId, initialPath, inbox);
  // A folder named in the address (« ?dossier= », from a path cited in the chat) opens here.
  // The first one is already the browser's starting folder; a cited folder gone opens the root.
  const { navigate: fbNavigate } = fb;
  const opened = useRef(openPath);
  useEffect(() => {
    if (!openPath || openPath === opened.current) return;
    opened.current = openPath;
    void fbNavigate(openPath, true);
  }, [openPath, fbNavigate]);
  const [preview, setPreview] = useState<FileEntry | null>(null);
  // A file named in the address opens once, checked like every path by the files routes.
  const shownFile = useRef<string | null>(null);
  useEffect(() => {
    if (!openFile || openFile === shownFile.current || !/^(~|\/home\/node)\/Livrables\//.test(openFile)) return;
    shownFile.current = openFile;
    setPreview({ name: openFile.split("/").pop() ?? openFile, path: openFile, type: "file", size: null, modified: 0 } as FileEntry);
  }, [openFile]);
  const [pendingDelete, setPendingDelete] = useState<FileEntry | null>(null);
  const [moving, setMoving] = useState<FileEntry | null>(null);
  // The folder a dragged file of the list is over (Leslie, 30/10: déplacer un livrable dans un dossier).
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // The gallery first, each deliverable seen as it is; the list stays one click away (Leslie, 16/11).
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  // An empty folder (the first day): one sentence and two quiet buttons; the view, sort, search and
  // import tools come back with the first file (Leslie, 27/10: seven tools for nothing).
  const empty = !fb.loading && !fb.opening && fb.entries.length === 0 && !fb.query.trim();
  const folderUploadRef = useRef<HTMLInputElement>(null);

  // `webkitdirectory` isn't in React's input typings, so set it on the DOM node directly. It makes
  // the picker select a whole folder; each file then reports its path under it via webkitRelativePath.
  useEffect(() => {
    folderUploadRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  // Inline rename — the row's name swaps to an input (Enter-commits / Escape-cancels). `skipBlur`
  // suppresses the commit the Escape-triggered blur would fire.
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const skipBlurRef = useRef(false);

  function startRename(entry: FileEntry) {
    setSelectedPath(entry.path);
    setEditingPath(entry.path);
    setDraft(entry.name);
  }
  function commitRename(entry: FileEntry) {
    setEditingPath(null);
    setSelectedPath(null);
    fb.rename(entry, draft);
  }
  function onRenameKeyDown(e: KeyboardEvent<HTMLInputElement>, entry: FileEntry) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename(entry);
    } else if (e.key === "Escape") {
      e.preventDefault();
      skipBlurRef.current = true;
      setEditingPath(null);
    }
  }

  function openEntry(entry: FileEntry) {
    if (isDir(entry)) {
      setSelectedPath(null);
      fb.openEntry(entry);
    } else {
      setSelectedPath(entry.path);
      setPreview(entry);
    }
  }

  function selectEntry(entry: FileEntry) {
    setSelectedPath(entry.path);
  }

  function onEntryKeyDown(e: KeyboardEvent<HTMLElement>, entry: FileEntry) {
    if (e.key === "Enter") {
      e.preventDefault();
      openEntry(entry);
    } else if (e.key === " ") {
      e.preventDefault();
      selectEntry(entry);
    }
  }

  // Selection is anchored to the listing, so clear it (and any in-progress rename) whenever the
  // directory changes out from under it.
  function resetSelection() {
    setSelectedPath(null);
    setEditingPath(null);
  }

  function navigate(path: string) {
    resetSelection();
    fb.navigate(path);
  }

  function goUp() {
    resetSelection();
    fb.goUp();
  }

  function selectForDelete(entry: FileEntry) {
    setSelectedPath(entry.path);
    setPendingDelete(entry);
  }

  function clearSelection() {
    if (!editingPath) setSelectedPath(null);
  }

  // Shared row/card interaction: one click opens (a folder, or the file's preview: Leslie, 26/10, a
  // double click is unknown on a phone), Space selects, Enter opens from the keyboard.
  // `stopPropagation` keeps the click from bubbling to the container's clear-selection handler.
  function entryHandlers(entry: FileEntry) {
    return {
      tabIndex: 0,
      onClick: (e: ReactMouseEvent<HTMLElement>) => {
        e.stopPropagation();
        openEntry(entry);
      },
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => onEntryKeyDown(e, entry),
      // A folder is read as soon as the pointer is on it: the click then opens it at once.
      onPointerEnter: isDir(entry) ? () => fb.prefetch(entry.path, HOVER_INTENT_MS) : undefined,
      onPointerLeave: isDir(entry) ? () => fb.prefetch(null) : undefined,
      onPointerDown: isDir(entry) ? () => fb.prefetch(entry.path) : undefined,
      // A file or folder of the list dragged onto a folder moves into it. Files dragged in from the
      // computer are left to the import drop zone around.
      draggable: true,
      onDragStart: (e: DragEvent<HTMLElement>) => {
        e.dataTransfer.setData(MOVE_TYPE, entry.path);
        e.dataTransfer.effectAllowed = "move";
      },
      onDragOver: isDir(entry)
        ? (e: DragEvent<HTMLElement>) => {
            if (!e.dataTransfer.types.includes(MOVE_TYPE)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDropTarget(entry.path);
          }
        : undefined,
      onDragLeave: isDir(entry) ? () => setDropTarget((t) => (t === entry.path ? null : t)) : undefined,
      onDrop: isDir(entry)
        ? (e: DragEvent<HTMLElement>) => {
            const from = e.dataTransfer.getData(MOVE_TYPE);
            setDropTarget(null);
            if (!from) return;
            e.preventDefault();
            e.stopPropagation();
            const moved = fb.visibleEntries.find((x) => x.path === from);
            if (moved && moved.path !== entry.path) void fb.move(moved, entry.path);
          }
        : undefined,
    };
  }

  const crumbs = useMemo(() => {
    const all = fb.path ? breadcrumbs(fb.path) : [];
    if (!home || !fb.path || !(fb.path === home || fb.path.startsWith(`${home}/`))) return all;
    return all.filter((c) => c.path.length >= home.length).map((c) => (c.path === home ? { ...c, label: "Livrables" } : c));
  }, [fb.path, home]);
  // A project folder shows its cover, picked like on the general page: its newest picture or PDF.
  const [covers, setCovers] = useState<Map<string, { path: string; modified: number }>>(new Map());
  useEffect(() => {
    let live = true;
    driveTree(agentId)
      .then((tree) => {
        if (!live) return;
        const m = new Map<string, { path: string; modified: number }>();
        for (const it of deliverableItems(tree.entries)) if (it.folder && it.cover) m.set(it.path, { path: it.cover, modified: it.coverModified });
        setCovers(m);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [agentId, fb.entries]);
  // A folder of visuals in variants shows by visual first (« Tous les fichiers » for the plain list),
  // and the editable « source » folder always comes last (Myriel, Leslie 30/10).
  const variants = useMemo(() => groupVariants(fb.visibleEntries.filter((e) => !isDir(e))), [fb.visibleEntries]);
  const [byVisual, setByVisual] = useState(true);
  // A document's older versions (« _v17 » beside « _v18 ») fold at the bottom (Leslie, 02/11): kept, never in the way.
  // « Archivées » (Leslie, 16/11) is no folder of the list: one line under the versions opens it.
  const isArchiveDir = (e: FileEntry) => isDir(e) && e.name === ARCHIVE_FOLDER;
  const { listEntries, olderVersions, kept, archiveDir } = useMemo(() => {
    const all = fb.visibleEntries.filter((e) => !isArchiveDir(e));
    const rest = variants && byVisual ? all.filter((e) => !variants.grouped.has(e)) : all;
    const { current, older } = splitVersions(rest);
    // The version that goes out: the latest of a document that has older ones, marked « Gardée ».
    const olderKeys = new Set(older.map((e) => versionOf(e.name)?.key));
    return {
      listEntries: [...current.filter((e) => !(isDir(e) && isSourceFolder(e.name))), ...current.filter((e) => isDir(e) && isSourceFolder(e.name))],
      olderVersions: older,
      kept: new Set(current.filter((e) => !isDir(e) && olderKeys.has(versionOf(e.name)?.key)).map((e) => e.path)),
      archiveDir: fb.visibleEntries.find(isArchiveDir) ?? null,
    };
  }, [fb.visibleEntries, variants, byVisual]);
  const inArchive = !!fb.path && isArchived(fb.path);

  // Archiving moves the files into « Archivées » beside them, made if needed; « Remettre » moves them back.
  // Nothing is deleted. One message for the lot, with « Annuler ».
  async function moveAll(moves: { from: string; to: string }[], mkdir: string | null): Promise<boolean> {
    try {
      if (mkdir) await apiFetch(`/api/agents/${agentId}/files/dir?path=${encodeURIComponent(mkdir)}`, { method: "POST" });
      for (const m of moves) {
        await apiFetch(`/api/agents/${agentId}/files`, { method: "PATCH", body: JSON.stringify(m) }, "Le fichier n’a pas pu être déplacé.");
      }
      return true;
    } catch (e) {
      toast.error((e as Error).message || "Le fichier n’a pas pu être déplacé.");
      return false;
    } finally {
      await fb.refresh();
    }
  }
  const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
  async function archive(entries: FileEntry[], done: string) {
    if (!entries.length) return;
    const dir = `${parentOf(entries[0].path)}/${ARCHIVE_FOLDER}`;
    const moves = entries.map((e) => ({ from: e.path, to: `${dir}/${e.name}` }));
    resetSelection();
    if (!(await moveAll(moves, dir))) return;
    toast.success(done, {
      action: { label: "Annuler", onClick: () => void moveAll(moves.map((m) => ({ from: m.to, to: m.from })), null) },
    });
  }
  async function restore(entry: FileEntry) {
    const to = `${parentOf(parentOf(entry.path))}/${entry.name}`;
    resetSelection();
    if (await moveAll([{ from: entry.path, to }], null)) toast.success(`${fileLabel(entry)} remis avec les autres versions`);
  }
  // « Garder » an older version: the newer ones go to « Archivées », so this one is again the latest, the one sent.
  function keep(entry: FileEntry) {
    const n = versionOf(entry.name)?.n;
    void archive(newerVersions(entry.name, [...listEntries, ...olderVersions]), `Version ${n} gardée. Les plus récentes sont dans Archivées.`);
  }
  const selectedEntry = useMemo(
    () => (selectedPath == null ? null : fb.visibleEntries.find((entry) => entry.path === selectedPath) ?? null),
    [fb.visibleEntries, selectedPath]
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col" {...fb.dragHandlers}>
      {fb.dragOver && <DropOverlay label="Déposez vos fichiers ici pour les importer" />}

      <header className="shrink-0 border-b bg-background px-4 py-3 md:px-6 lg:px-8">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          {/* Where one is, as a path to click (Leslie, 23/10: the « Retour » button was not clear):
              « ‹ Livrables » goes back up one folder and says where to; each step of the path opens it. */}
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {!fb.atRoot && crumbs.length > 1 && (
              <BackButton
                label={crumbs[crumbs.length - 2].label}
                onClick={() => (fb.parentPath ? goUp() : navigate(crumbs[crumbs.length - 2].path))}
                className="mr-2"
              />
            )}
            <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" aria-label="Chemin du dossier">
              {crumbs.length === 0 ? (
                <span className="text-sm text-muted-foreground">Chargement…</span>
              ) : (
                crumbs.map((c, i) => {
                  const last = i === crumbs.length - 1;
                  return (
                    <span key={c.path} className="flex shrink-0 items-center">
                      {i > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <button
                        type="button"
                        onClick={() => !last && navigate(c.path)}
                        aria-current={last ? "page" : undefined}
                        className={cn(
                          "max-w-[14rem] truncate rounded-md px-2 py-1 transition-colors",
                          last ? "cursor-default text-[17px] font-semibold text-foreground" : "text-[15px] text-muted-foreground underline-offset-4 hover:bg-secondary hover:text-foreground hover:underline"
                        )}
                      >
                        {c.label}
                      </button>
                    </span>
                  );
                })
              )}
              {/* The folder being opened, named at once, before its listing lands. */}
              {fb.opening && fb.path && fb.opening.startsWith(`${fb.path}/`) && (
                <span className="flex shrink-0 items-center text-[15px] text-muted-foreground">
                  <ChevronRight className="h-4 w-4" />
                  <span className="max-w-[14rem] truncate px-2 py-1">{fb.opening.split("/").filter(Boolean).pop()}</span>
                  <Loader2 className="h-4 w-4 animate-spin" aria-label="Ouverture du dossier" />
                </span>
              )}
            </nav>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1 xl:ml-auto">
            {selectedEntry && (
              <SelectedActions
                agentId={agentId}
                entry={selectedEntry}
                onRename={startRename}
                onMove={setMoving}
                onDelete={selectForDelete}
              />
            )}
            {!empty && (
              <>
            {/* A deliverable's folder downloads whole, in one click (Myriel, Leslie 30/10). */}
            {!fb.atRoot && fb.path && (
              <Button asChild size="sm" className="h-9">
                <a href={archiveUrl(agentId, fb.path)} download>
                  <Download className="h-4 w-4" />
                  Tout télécharger
                </a>
              </Button>
            )}
            <ViewToggle value={viewMode} onChange={setViewMode} />
            <ToolbarIconButton onClick={fb.refresh} label="Actualiser">
              <RefreshCw className={cn("h-4 w-4", fb.loading && "animate-spin")} />
            </ToolbarIconButton>
            <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
            {/* Only the Experts make folders here (Myriel, Leslie 30/10): no « Nouveau dossier ». */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" disabled={!fb.path || fb.uploading} className="h-9">
                  {fb.uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Importer
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => uploadRef.current?.click()}>
                  <Upload className="h-4 w-4" />
                  Des fichiers
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => folderUploadRef.current?.click()}>
                  <FolderUp className="h-4 w-4" />
                  Un dossier
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
              </>
            )}
            <HiddenFileInput inputRef={uploadRef} onFiles={fb.uploadFiles} />
            <HiddenFileInput inputRef={folderUploadRef} onFiles={fb.uploadFolder} />
          </div>
        </div>
        <div className={cn("mt-2 flex flex-wrap items-center gap-2", empty && "hidden")}>
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border bg-card px-3 shadow-sm sm:max-w-md">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              type="search"
              value={fb.query}
              onChange={(e) => fb.setQuery(e.target.value)}
              placeholder="Rechercher dans ce dossier"
              aria-label="Rechercher dans ce dossier"
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            />
            {fb.query && (
              <button type="button" onClick={() => fb.setQuery("")} aria-label="Effacer la recherche" className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-secondary">
                <X className="h-4 w-4" />
              </button>
            )}
          </label>
          <div role="radiogroup" aria-label="Trier" className="flex h-10 shrink-0 items-center rounded-md border bg-card p-1 text-sm">
            {(
              [
                ["recent", "Plus récent"],
                ["name", "A à Z"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={fb.sortBy === v}
                onClick={() => fb.setSortBy(v)}
                className={cn("h-full rounded px-3 font-medium transition-colors", fb.sortBy === v ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {fb.loading && fb.entries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : fb.error ? (
          <div className="p-6 md:px-10">
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{fb.error}</p>
          </div>
        ) : (
          // While a folder opens, the list it replaces no longer takes clicks.
          <div
            className={cn("w-full p-4 transition-opacity md:p-6 lg:p-8", fb.opening && "pointer-events-none opacity-50")}
            aria-busy={!!fb.opening}
            onClick={clearSelection}
          >
            {fb.visibleEntries.length === 0 && fb.query.trim() ? (
              <p className="px-3 py-10 text-center text-sm text-muted-foreground">Aucun fichier ne correspond à « {fb.query.trim()} ».</p>
            ) : fb.visibleEntries.length === 0 ? (
              <EmptyFolder
                owner={ownerOf(fb.path)}
                canCreate={!!fb.path}
                uploading={fb.uploading}
                onUpload={() => uploadRef.current?.click()}
              />
            ) : (
              <>
            {variants && (
              <div className="mb-4 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
                <div role="radiogroup" aria-label="Présentation des visuels" className="flex h-10 w-fit items-center rounded-md border bg-card p-1 text-sm">
                  {(
                    [
                      [true, "Par visuel"],
                      [false, "Tous les fichiers"],
                    ] as const
                  ).map(([v, label]) => (
                    <button
                      key={label}
                      type="button"
                      role="radio"
                      aria-checked={byVisual === v}
                      onClick={() => setByVisual(v)}
                      className={cn("h-full rounded px-3 font-medium", byVisual === v ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {byVisual && <VariantGroups agentId={agentId} groups={variants.groups} onOpen={(e) => openEntry(e)} />}
              </div>
            )}
            {listEntries.length === 0 ? null : viewMode === "list" ? (
              <div className="overflow-x-auto rounded-lg border bg-card">
                <table className="w-full min-w-[700px] table-fixed text-sm">
                  <colgroup>
                    <col />
                    <col className="w-28" />
                    <col className="w-56" />
                  </colgroup>
                  <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="px-4 py-3 font-medium">Nom</th>
                      <th className="px-4 py-3 text-right font-medium">Taille</th>
                      <th className="px-4 py-3 font-medium">Modifié le</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listEntries.map((entry) => {
                      const editing = editingPath === entry.path;
                      const selected = selectedEntry?.path === entry.path;
                      return (
                        <tr
                          key={entry.path}
                          aria-selected={selected}
                          className={cn(
                            "cursor-default select-none border-b border-border/70 outline-none last:border-0 hover:bg-secondary/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            selected && "bg-primary/10 text-foreground hover:bg-primary/10",
                            dropTarget === entry.path && "bg-primary/15 ring-2 ring-inset ring-primary/40"
                          )}
                          {...entryHandlers(entry)}
                        >
                          <td className="min-w-0 px-4 py-3">
                            {editing ? (
                              <RenameInput
                                entry={entry}
                                draft={draft}
                                setDraft={setDraft}
                                onRenameKeyDown={onRenameKeyDown}
                                commitRename={commitRename}
                                skipBlurRef={skipBlurRef}
                              />
                            ) : (
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="min-w-0 flex-1">
                                  <EntryName entry={entry} selected={selected} />
                                </span>
                                {kept.has(entry.path) && <KeptPill />}
                                {inArchive && !isDir(entry) && <RestoreButton onClick={() => void restore(entry)} />}
                              </div>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-muted-foreground">
                            {formatBytes(entry.size)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                            {formatMtime(entry.modified)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(190px,1fr))] sm:gap-3">
                {listEntries.map((entry) => {
                  const editing = editingPath === entry.path;
                  const selected = selectedEntry?.path === entry.path;
                  return (
                    <div
                      key={entry.path}
                      aria-selected={selected}
                      className={cn(
                        "group flex cursor-default select-none flex-col overflow-hidden rounded-lg border bg-card outline-none transition-colors hover:border-primary/35 hover:bg-secondary/25 focus-visible:ring-2 focus-visible:ring-ring",
                        selected && "border-primary/35 bg-primary/10 hover:border-primary/35 hover:bg-primary/10",
                        dropTarget === entry.path && "border-primary bg-primary/15"
                      )}
                      {...entryHandlers(entry)}
                    >
                      <EntryCover agentId={agentId} entry={entry} cover={covers.get(entry.path)} />
                      <div className="min-w-0 flex-1 px-3 pt-2.5">
                        {editing ? (
                          <RenameInput
                            entry={entry}
                            draft={draft}
                            setDraft={setDraft}
                            onRenameKeyDown={onRenameKeyDown}
                            commitRename={commitRename}
                            skipBlurRef={skipBlurRef}
                          />
                        ) : (
                          <EntryName entry={entry} layout="grid" selected={selected} />
                        )}
                        {kept.has(entry.path) && <KeptPill className="mt-1.5" />}
                        {inArchive && !isDir(entry) && <RestoreButton className="mt-1.5" onClick={() => void restore(entry)} />}
                      </div>
                      <div className="truncate px-3 pb-3 pt-1 text-xs text-muted-foreground">
                        {formatMtime(entry.modified) || "Date inconnue"}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
              </>
            )}

            {olderVersions.length > 0 && (
              <details className="group mt-4 rounded-lg border bg-card" onClick={(e) => e.stopPropagation()}>
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium text-muted-foreground hover:text-foreground">
                  <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
                  Versions précédentes ({olderVersions.length})
                </summary>
                <ul className="border-t">
                  {olderVersions.map((entry) => (
                    <li
                      key={entry.path}
                      className="flex min-h-11 cursor-default select-none items-center gap-3 border-b border-border/70 px-4 py-2 text-sm last:border-0 hover:bg-secondary/35"
                      {...entryHandlers(entry)}
                    >
                      <span className="min-w-0 flex-1">
                        <EntryName entry={entry} selected={selectedEntry?.path === entry.path} />
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground max-sm:hidden">{formatBytes(entry.size)}</span>
                      <span className="w-44 shrink-0 text-right text-xs text-muted-foreground max-sm:hidden">{formatMtime(entry.modified)}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          keep(entry);
                        }}
                        className="inline-flex h-9 shrink-0 items-center rounded-full border bg-background px-3.5 text-[13px] font-semibold hover:bg-secondary"
                      >
                        Garder
                      </button>
                      <button
                        type="button"
                        aria-label={`Archiver ${fileLabel(entry)}`}
                        title="Archiver"
                        onClick={(e) => {
                          e.stopPropagation();
                          void archive([entry], `${fileLabel(entry)} archivé. Rien n’est supprimé.`);
                        }}
                        className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <Archive className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {archiveDir && (
              <button
                type="button"
                onClick={() => navigate(archiveDir.path)}
                className="mt-3 flex min-h-11 w-full items-center gap-2 rounded-lg border border-dashed bg-secondary/40 px-4 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                <Archive className="size-4" />
                <span className="flex-1">Archivées</span>
                <ChevronRight className="size-4" />
              </button>
            )}
            {inArchive && listEntries.length > 0 && (
              <p className="mt-3 px-1 text-[13px] text-muted-foreground">Rien n’est supprimé ici. L’Expert ne propose plus ces versions.</p>
            )}

            {fb.truncated && (
              <p className="mt-3 px-3 text-xs text-muted-foreground">
                Seuls les 1 000 premiers éléments sont affichés. Ouvrez un sous-dossier pour voir les autres.
              </p>
            )}
          </div>
        )}
      </div>

      <FilePreview agentId={agentId} entry={preview} onClose={() => setPreview(null)} />
      <MoveDialog agentId={agentId} entry={moving} onMove={(entry, dest) => void fb.move(entry, dest)} onClose={() => setMoving(null)} />


      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Supprimer cet élément ?"
        description={
          pendingDelete
            ? `« ${pendingDelete.name} » sera supprimé définitivement${
                isDir(pendingDelete) ? ", avec tout ce qu’il contient" : ""
              }. Cette action est irréversible.`
            : undefined
        }
        confirmText="Supprimer"
        destructive
        onConfirm={async () => {
          if (pendingDelete) await fb.remove(pendingDelete);
        }}
      />
    </div>
  );
}

const VIEW_MODES = [
  { mode: "list" as const, Icon: List, label: "Vue en liste" },
  { mode: "grid" as const, Icon: Grid2X2, label: "Vue en grille" },
];

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (value: ViewMode) => void }) {
  return (
    <div className="inline-flex h-9 rounded-md border bg-background p-0.5" role="group" aria-label="Affichage des fichiers">
      {VIEW_MODES.map(({ mode, Icon, label }) => (
        <button
          key={mode}
          type="button"
          aria-pressed={value === mode}
          aria-label={label}
          title={label}
          onClick={() => onChange(mode)}
          className={cn(
            "inline-flex size-8 items-center justify-center rounded transition-colors",
            value === mode ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}

function ToolbarIconButton({
  onClick,
  label,
  disabled,
  children,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="text-muted-foreground hover:text-foreground"
    >
      {children}
    </Button>
  );
}

function SelectedActions({
  agentId,
  entry,
  onRename,
  onMove,
  onDelete,
}: {
  agentId: string;
  entry: FileEntry;
  onRename: (entry: FileEntry) => void;
  onMove: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
}) {
  return (
    <div className="mr-1 flex items-center gap-1 border-r pr-2">
      <Button asChild variant="outline" size="icon" className="size-9" title="Télécharger">
        <a
          href={isDir(entry) ? archiveUrl(agentId, entry.path) : contentUrl(agentId, entry.path, "attachment")}
          download={isDir(entry) ? `${entry.name}.tar.gz` : fileLabel(entry)}
          aria-label={isDir(entry) ? `Télécharger ${entry.name} en archive .tar.gz` : `Télécharger ${entry.name}`}
        >
          <Download className="h-4 w-4" />
        </a>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => onRename(entry)}
        className="size-9"
        aria-label={`Renommer ${entry.name}`}
        title="Renommer"
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => onMove(entry)}
        className="size-9"
        aria-label={`Déplacer ${fileLabel(entry)}`}
        title="Déplacer vers…"
      >
        <FolderInput className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => onDelete(entry)}
        className="size-9 hover:bg-destructive/10 hover:text-destructive"
        aria-label={`Supprimer ${entry.name}`}
        title="Supprimer"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

function EntryName({
  entry,
  layout = "list",
  selected,
}: {
  entry: FileEntry;
  layout?: ViewMode;
  selected: boolean;
}) {
  const dir = isDir(entry);

  return (
    <div
      className={cn(
        "min-w-0 text-left",
        layout === "grid"
          ? "flex w-full flex-col items-start"
          : "grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3"
      )}
    >
      {layout !== "grid" && <EntryGlyph entry={entry} selected={selected} />}
      <span
        className={cn(
          "min-w-0 truncate",
          layout === "grid" ? "w-full text-sm font-semibold" : "text-sm",
          dir ? "font-medium text-foreground" : "text-foreground",
          entry.hidden && "text-muted-foreground"
        )}
      >
        {fileLabel(entry)}
        {dir && isSourceFolder(entry.name) && <small className="block truncate text-xs font-normal text-muted-foreground">Fichiers modifiables : HTML, images, polices</small>}
      </span>
    </div>
  );
}

function EntryGlyph({ entry, large = false, selected = false }: { entry: FileEntry; large?: boolean; selected?: boolean }) {
  const dir = isDir(entry);
  const iconClassName = cn(large ? "h-7 w-7" : "h-4 w-4", "shrink-0");

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md",
        large ? "size-12" : "size-7",
        dir ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground",
        selected && "bg-background text-primary"
      )}
    >
      {dir ? (
        <Folder className={iconClassName} />
      ) : shortcutKind(entry.name) ? (
        <GoogleGlyph kind={shortcutKind(entry.name)!} className={large ? "h-8 w-6" : "h-[18px] w-[14px]"} />
      ) : entry.type === "symlink" ? (
        <Link2 className={iconClassName} />
      ) : (
        <FileIcon className={iconClassName} />
      )}
    </span>
  );
}

function RenameInput({
  entry,
  draft,
  setDraft,
  onRenameKeyDown,
  commitRename,
  skipBlurRef,
}: {
  entry: FileEntry;
  draft: string;
  setDraft: (draft: string) => void;
  onRenameKeyDown: (e: KeyboardEvent<HTMLInputElement>, entry: FileEntry) => void;
  commitRename: (entry: FileEntry) => void;
  skipBlurRef: { current: boolean };
}) {
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        onRenameKeyDown(e, entry);
      }}
      onBlur={() => {
        if (skipBlurRef.current) {
          skipBlurRef.current = false;
          return;
        }
        commitRename(entry);
      }}
      aria-label="Nom du fichier"
      className="w-full rounded-md bg-background px-2 py-1.5 text-sm text-foreground outline-none ring-1 ring-ring"
    />
  );
}

// « ~/Livrables/Fatima » is Fatima's folder: the empty one says whose deliverables will land there.
function ownerOf(path: string | null | undefined): string | null {
  const parts = (path ?? "").split("/").filter(Boolean);
  const i = parts.lastIndexOf("Livrables");
  return i >= 0 && i === parts.length - 2 ? parts[i + 1] : null;
}

function EmptyFolder({
  owner,
  canCreate,
  uploading,
  onUpload,
}: {
  owner: string | null;
  canCreate: boolean;
  uploading: boolean;
  onUpload: () => void;
}) {
  return (
    <div className="flex min-h-[20rem] flex-col items-center justify-center rounded-lg border border-dashed bg-secondary/20 p-8 text-center">
      <span className="mb-4 inline-flex size-12 items-center justify-center rounded-md bg-background text-primary shadow-sm">
        <Folder className="h-7 w-7" />
      </span>
      <p className="text-sm font-medium text-foreground">{owner ? `Les livrables de ${owner} arriveront ici.` : "Ce dossier est vide."}</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" size="sm" onClick={onUpload} disabled={!canCreate || uploading}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Importer des fichiers
        </Button>
      </div>
    </div>
  );
}


// What a card shows above its name: the deliverable itself (a picture reduced on the server, a PDF's first page),
// a slide, a page or a sheet drawn by the app, a project's cover, else its kind in large. Same covers as the general page.
function EntryCover({ agentId, entry, cover }: { agentId: string; entry: FileEntry; cover?: { path: string; modified: number } }) {
  const [failed, setFailed] = useState(false);
  const target = isDir(entry) ? cover ?? null : coverRank(entry.name) ? { path: entry.path, modified: entry.modified ?? 0 } : null;
  const name = target?.path.split("/").pop() ?? "";
  const kind = target ? docKind(name) : null;
  return (
    <span className="relative block aspect-[4/3] w-full overflow-hidden bg-secondary/60">
      {target && !failed ? (
        kind === "image" ? (
          <ReducedImage
            thumb={thumbUrl(agentId, target.path, 480, target.modified)}
            original={thumbUrl(agentId, target.path, 480)}
            alt=""
            className="size-full object-cover"
            onFail={() => setFailed(true)}
          />
        ) : (
          <span className="pointer-events-none block size-full">
            <DocPreview agentId={agentId} doc={{ name, path: target.path, size: null, modified: target.modified, kind: kind! }} />
          </span>
        )
      ) : (
        <span className="grid size-full place-items-center">
          <EntryGlyph entry={entry} large />
        </span>
      )}
      {isDir(entry) && target && !failed && (
        <span className="absolute left-2 top-2 grid size-7 place-items-center rounded-md bg-background/90 text-primary shadow-sm">
          <Folder className="size-4" />
        </span>
      )}
    </span>
  );
}

// The version that goes out, beside the latest of a document with older versions (Leslie, 16/11).
function KeptPill({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300", className)}>
      <Check className="size-3" />
      Gardée
    </span>
  );
}

function RestoreButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border bg-background px-3 text-[12.5px] font-semibold hover:bg-secondary", className)}
    >
      <ArchiveRestore className="size-3.5" />
      Remettre
    </button>
  );
}
