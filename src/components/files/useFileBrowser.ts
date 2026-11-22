"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { apiFetch, readApiError } from "@/lib/api";
import { runPool } from "@/lib/bulk";
import { optimistic } from "@/lib/optimistic";
import { DRIVE_ABS, DRIVE_ROOT, fileLabel, isDriveRoot } from "@/lib/drive-paths";
import { driveChanged } from "@/lib/drive-store";
import { isDriveClutter, matchesDriveQuery, sortDriveEntries, type DriveSort } from "@/lib/drive-order";
import { shrinkPicture } from "@/lib/shrink-image";
import { needsParts, PART_BYTES, TOO_LARGE, TOO_LARGE_DOCUMENT, tooLargeDocument } from "@/lib/upload-limit";
import { PartsError, sendInParts } from "@/lib/upload-parts";
import { useDropZone } from "../useDropZone";
import { joinPath, type FileEntry, type FileListResponse } from "./types";

// Owns the Files tab's directory state + mutations. One hook instance per pane, callbacks
// memoised, a ref-counted drag overlay. The current directory's resolved absolute `path` comes
// from the Agents API (it resolves ~ / defaults), so navigation, upload targets, and
// new-folder/rename paths are all derived from the listing the server returns. Every call targets
// the active agent via the `agentId` prop (this app is multi-agent).
export function useFileBrowser(agentId: string, initialPath?: string, inbox?: string) {
  const [path, setPath] = useState<string | null>(null); // resolved abs dir; null until first load
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [sortBy, setSortBy] = useState<DriveSort>("recent");
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(0); // count of in-flight uploads

  // Guard against an older list response landing after a newer navigation.
  const loadSeq = useRef(0);
  // The folder a click is opening, until its listing lands: the old list stays on screen but no
  // longer takes clicks, so a second tap never lands on a row that is about to be replaced (Leslie,
  // 27/10: « tu cliques, ça t'amène sur autre chose »).
  const [opening, setOpening] = useState<string | null>(null);
  // Listings already read in this pane, by the path asked and the path resolved: a folder opened
  // again, or read ahead on hover, shows at once and is refreshed behind.
  const cache = useRef(new Map<string, FileListResponse>());
  const inFlight = useRef(new Map<string, Promise<FileListResponse>>());

  // Mirror `path` into a ref so a long-running upload can tell whether the user has since navigated
  // away — if so, the post-upload refresh must not pull them back to the directory it started in.
  const pathRef = useRef<string | null>(null);
  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  // `fresh`: after a change, a reading started before it would answer the folder as it was (the file
  // just imported shows, then vanishes, then shows again: Leslie, 30/10). It is not reused.
  const fetchList = useCallback(
    (target?: string, fresh = false) => {
      const key = target ?? "";
      const running = inFlight.current.get(key);
      if (running && !fresh) return running;
      const qs = target ? `?path=${encodeURIComponent(target)}` : "";
      const p = apiFetch<FileListResponse>(`/api/agents/${agentId}/files/list${qs}`)
        .then((res) => {
          cache.current.set(key, res);
          cache.current.set(res.path, res);
          return res;
        })
        .finally(() => {
          if (inFlight.current.get(key) === p) inFlight.current.delete(key);
        });
      inFlight.current.set(key, p);
      return p;
    },
    [agentId]
  );

  const show = useCallback((res: FileListResponse) => {
    setPath(res.path);
    setParentPath(res.parentPath);
    setEntries(res.entries);
    setTruncated(res.truncated);
  }, []);

  // Load one directory level. `target` undefined loads the agent's default workspace dir (first
  // mount); on success the resolved abs path replaces whatever we asked for. A folder already read
  // shows at once from the cache, then the fresh listing replaces it.
  // `orRoot`: a folder that cannot be opened falls back to the drive's root instead of an error.
  const load = useCallback(
    async (target?: string, orRoot = false, fresh = false): Promise<void> => {
      const seq = ++loadSeq.current;
      const known = fresh ? undefined : cache.current.get(target ?? "");
      if (known) show(known);
      setOpening(known ? null : (target ?? null));
      setLoading(true);
      setError(null);
      try {
        const res = await fetchList(target, fresh);
        if (seq !== loadSeq.current) return; // a newer load superseded us
        show(res);
      } catch (e) {
        if (seq !== loadSeq.current) return;
        if (orRoot && target) return load();
        setError((e as Error).message || "Ce dossier n’a pas pu être ouvert.");
      } finally {
        if (seq === loadSeq.current) {
          setLoading(false);
          setOpening(null);
        }
      }
    },
    [fetchList, show]
  );

  // After a change in a folder: its cached listing is stale under every name it was read by (the path
  // asked and the path resolved), and a reading in flight predates the change: read it again, fresh.
  // The drive's other views (Livrables, the home) are told too.
  const forget = useCallback((target?: string) => {
    const key = target ?? "";
    const resolved = cache.current.get(key)?.path ?? key;
    for (const [k, v] of cache.current) if (k === key || k === resolved || v.path === resolved) cache.current.delete(k);
  }, []);
  const reload = useCallback(
    (target?: string) => {
      forget(target);
      driveChanged(agentId);
      return load(target, false, true);
    },
    [agentId, forget, load]
  );

  // Read a folder ahead (pointer resting on it, or pressed), so the click opens it at once. One pending
  // at a time: a new target or `null` (pointer gone) cancels the one waiting.
  const intent = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetch = useCallback(
    (target: string | null, afterMs = 0) => {
      if (intent.current) clearTimeout(intent.current);
      intent.current = null;
      if (!target || cache.current.has(target)) return;
      const read = () => void fetchList(target).catch(() => {});
      if (afterMs > 0) intent.current = setTimeout(read, afterMs);
      else read();
    },
    [fetchList]
  );
  useEffect(
    () => () => {
      if (intent.current) clearTimeout(intent.current);
    },
    []
  );

  // Initial load: the drive's root, or the folder the caller starts in (an expert's own). A
  // starting folder that does not exist yet falls back to the root instead of an error screen.
  const initialPathRef = useRef(initialPath);
  useEffect(() => {
    // One reading: the folder itself, the root only if it cannot be opened.
    void load(initialPathRef.current, true);
  }, [agentId, load]);

  // The search is the folder's: opening another one starts it again.
  const navigate = useCallback(
    (target: string, orRoot = false) => {
      setQuery("");
      return load(target, orRoot);
    },
    [load]
  );
  const refresh = useCallback(() => {
    if (path) cache.current.delete(path);
    return load(path ?? undefined);
  }, [load, path]);
  // The drive's root has nothing above it that a member may open.
  const atRoot = path === null || isDriveRoot(path);
  const goUp = useCallback(() => {
    if (parentPath && !atRoot) load(parentPath);
  }, [load, parentPath, atRoot]);

  // Open an entry: directories (and dir symlinks) navigate; everything else is left to the caller
  // (preview/download), which knows the entry.
  const openEntry = useCallback(
    (entry: FileEntry) => {
      if (entry.type === "directory") navigate(entry.path);
    },
    [navigate]
  );

  // PUT one file to `relPath` under the current dir. `relPath` may contain slashes (a folder
  // upload passes webkitRelativePath); the Agents API creates the parent dirs (mkdir -p) on write.
  // The PUT goes through the BFF content route, which buffers the streamed body to a known
  // Content-Length — the instance-host proxy drops chunked uploads (→ 0-byte files), so the
  // component just PUTs the File and lets the route frame it.
  const putFile = useCallback(
    async (file: File, relPath: string, dir: string): Promise<void> => {
      const target = joinPath(dir, relPath);
      // Over the host's limit: in parts of 3 MB (lib/upload-parts.ts); a back office without them keeps 4 MB.
      if (needsParts(file)) {
        await sendInParts(file, { kind: "drive", agentId, path: target, overwrite: true }, { partBytes: PART_BYTES }).catch((e: unknown) => {
          throw e instanceof PartsError && e.status === 404 ? new Error(TOO_LARGE) : e;
        });
        return;
      }
      const res = await fetch(
        `/api/agents/${agentId}/files/content?path=${encodeURIComponent(target)}&overwrite=true`,
        { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file }
      );
      if (!res.ok) throw new Error(await readApiError(res, "L’import a échoué"));
    },
    [agentId]
  );

  // What the member brings lands in the inbox (« Reçus »), never among what the Expert made (Leslie,
  // 30/10). Already in the inbox, or below it, a file lands where one is.
  const inboxAbs = inbox ? inbox.replace(DRIVE_ROOT, DRIVE_ABS).replace(/\/+$/, "") : null;
  const uploadDir = useCallback(
    (here: string) => (inboxAbs && here !== inboxAbs && !here.startsWith(`${inboxAbs}/`) ? inboxAbs : here),
    [inboxAbs]
  );

  // Upload a batch of (file, destination-relative-path) pairs to the current dir, then refresh once.
  // overwrite=true mirrors a normal desktop drop (replace in place); a failed file is toasted but
  // doesn't abort the batch. Concurrency is bounded so a deep folder can't open a socket per file.
  const uploadEntries = useCallback(
    async (given: { file: File; relPath: string }[]) => {
      // A photo over the limit is made smaller first (lib/shrink-image.ts), under the name it now has.
      const all = await Promise.all(
        given.map(async ({ file, relPath }) => {
          const small = await shrinkPicture(file);
          return small === file ? { file, relPath } : { file: small, relPath: relPath.replace(/[^/]+$/, small.name) };
        })
      );
      // A file over the limit would be refused by the host with a page of its own: say it here.
      const items = all.filter(({ file }) => !tooLargeDocument(file));
      for (const { relPath } of all.filter(({ file }) => tooLargeDocument(file)).slice(0, 3)) toast.error(`${relPath} : ${TOO_LARGE_DOCUMENT}`);
      if (all.length - items.length > 3) toast.error(`${all.length - items.length - 3} autres fichiers dépassent 25 Mo.`);
      if (!items.length || !path) return;
      const dir = uploadDir(path);
      setUploading((n) => n + items.length);
      let failures = 0;
      try {
        await runPool(items, 4, async ({ file, relPath }) => {
          try {
            await putFile(file, relPath, dir);
          } catch (e) {
            failures += 1;
            toast.error(`${relPath} : ${(e as Error).message}`);
          }
        });
      } finally {
        setUploading((n) => Math.max(0, n - items.length));
      }
      const ok = items.length - failures;
      const where = dir === path ? "" : ` dans ${dir.split("/").pop()}`;
      if (ok > 0) toast.success(ok === 1 ? `1 fichier importé${where}` : `${ok} fichiers importés${where}`);
      // Refresh only if the user is still in the directory we uploaded into. A folder upload can run
      // for many seconds; reloading the captured `path` would otherwise undo a navigation made while
      // it was in flight.
      // Brought into the inbox from elsewhere: the inbox opens, so what was imported shows.
      if (pathRef.current === path) {
        if (dir !== path && ok > 0) {
          forget(dir);
          driveChanged(agentId);
          setQuery("");
          await load(dir, false, true);
        } else await reload(path);
      }
    },
    [agentId, path, putFile, reload, uploadDir, forget, load]
  );

  // Flat upload (the multi-file picker + drag-drop): each file lands by its basename.
  const uploadFiles = useCallback(
    (incoming: FileList | File[]) =>
      uploadEntries(Array.from(incoming).map((file) => ({ file, relPath: file.name }))),
    [uploadEntries]
  );

  // Folder upload (webkitdirectory picker): webkitRelativePath carries the tree under the picked
  // folder (e.g. "proj/src/a.ts"), so the structure is recreated under the current dir. Empty
  // subfolders are dropped — the browser only enumerates files, matching every per-file uploader.
  const uploadFolder = useCallback(
    (incoming: FileList | File[]) =>
      uploadEntries(
        Array.from(incoming).map((file) => ({
          file,
          relPath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
        }))
      ),
    [uploadEntries]
  );

  const createDir = useCallback(
    async (name: string) => {
      const clean = name.trim();
      if (!clean || !path) return;
      try {
        await apiFetch(`/api/agents/${agentId}/files/dir?path=${encodeURIComponent(joinPath(path, clean))}`, {
          method: "POST",
        });
        toast.success("Dossier créé");
        await reload(path);
      } catch (e) {
        toast.error((e as Error).message || "Le dossier n’a pas pu être créé.");
      }
    },
    [agentId, path, reload]
  );

  // Rename in place: the entry lives in the current dir, so `to` is the new basename joined onto it.
  const rename = useCallback(
    async (entry: FileEntry, newName: string) => {
      const clean = newName.trim();
      if (!clean || !path || clean === entry.name) return;
      // Shown under its new name at once; back to the old one, with the refusal, if the instance says no.
      const to = joinPath(path, clean);
      const ok = await optimistic({
        apply: () => setEntries((list) => list.map((e) => (e.path === entry.path ? { ...e, name: clean, path: to } : e))),
        run: () => apiFetch(`/api/agents/${agentId}/files`, { method: "PATCH", body: JSON.stringify({ from: entry.path, to }) }, "Le renommage a échoué."),
        rollback: () => setEntries((list) => list.map((x) => (x.path === to ? entry : x))),
        refused: (m) => toast.error(m),
      });
      if (ok) await reload(path);
    },
    [agentId, path, reload]
  );

  // Move into another folder of the drive (« Déplacer vers… », or a file dropped on a folder: Leslie, 30/10).
  const move = useCallback(
    async (entry: FileEntry, destDir: string) => {
      const dest = destDir.replace(DRIVE_ROOT, DRIVE_ABS).replace(/\/+$/, "");
      // Already there, or onto itself: nothing to do.
      if (!path || dest === entry.path || entry.path.slice(0, entry.path.lastIndexOf("/")) === dest) return;
      if (dest.startsWith(`${entry.path}/`)) {
        toast.error("Un dossier ne peut pas aller dans lui-même.");
        return;
      }
      try {
        await apiFetch(`/api/agents/${agentId}/files`, {
          method: "PATCH",
          body: JSON.stringify({ from: entry.path, to: joinPath(dest, entry.name) }),
        });
        forget(dest);
        toast.success(`${fileLabel(entry)} déplacé dans ${isDriveRoot(dest) ? "Livrables" : dest.split("/").pop()}`);
        await reload(path);
      } catch (e) {
        toast.error((e as Error).message || "Le déplacement a échoué.");
      }
    },
    [agentId, path, forget, reload]
  );

  const remove = useCallback(
    async (entry: FileEntry) => {
      try {
        await apiFetch(`/api/agents/${agentId}/files?path=${encodeURIComponent(entry.path)}`, { method: "DELETE" });
        toast.success(`${entry.name} supprimé`);
        await reload(path ?? undefined);
      } catch (e) {
        toast.error((e as Error).message || "La suppression a échoué.");
      }
    },
    [agentId, path, reload]
  );

  // Whole-pane drag-drop overlay.
  const { dragOver, dragHandlers } = useDropZone(uploadFiles);

  // Hidden files, the expert's working files and the chat's preview pictures stay out unless asked
  // for; the memory folder first, then the newest change first or A to Z (src/lib/drive-order.ts).
  const masked = useCallback((e: FileEntry) => e.hidden || isDriveClutter(e), []);
  const visibleEntries = useMemo(
    () => sortDriveEntries((showHidden ? entries : entries.filter((e) => !masked(e))).filter((e) => matchesDriveQuery(e.name, query)), sortBy),
    [entries, showHidden, masked, query, sortBy]
  );
  const hiddenCount = useMemo(() => entries.reduce((n, e) => n + (masked(e) ? 1 : 0), 0), [entries, masked]);

  return {
    path,
    parentPath,
    atRoot,
    entries,
    visibleEntries,
    hiddenCount,
    truncated,
    loading,
    error,
    showHidden,
    setShowHidden,
    sortBy,
    setSortBy,
    query,
    setQuery,
    uploading: uploading > 0,
    dragOver,
    dragHandlers,
    navigate,
    prefetch,
    opening,
    refresh,
    goUp,
    openEntry,
    uploadFiles,
    uploadFolder,
    createDir,
    rename,
    move,
    remove,
  };
}

export type FileBrowser = ReturnType<typeof useFileBrowser>;
