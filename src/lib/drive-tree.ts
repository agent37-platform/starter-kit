// The drive three levels deep (Livrables/<Expert>/<dossier>/fichier), for every screen that watches or
// lists deliverables. The runtime gateway walks it itself (`/files/tree`, cached there); until that
// endpoint is deployed (404), the app walks it: a bounded number of folders, a few at a time, the
// experts' memory folders not entered. `complete` is false when a folder could not be listed.
import { runPool } from "./bulk.ts";
import { isMemoryFolder } from "./drive-order.ts";
import { DRIVE_ROOT, type DriveTree } from "./drive-paths.ts";
import type { FileEntry } from "./types.ts";

export const TREE_DEPTH = 3;
const MAX_FOLDERS = 40;
const PARALLEL = 6;

export interface TreeSource {
  /** The gateway's own walk; rejects with a `status` 404 where it is not deployed. */
  tree(root: string, depth: number): Promise<DriveTree>;
  list(path: string): Promise<FileEntry[]>;
  /** The root on an instance never prepared: created on first look. */
  makeDir(path: string): Promise<unknown>;
}

const isNotFound = (e: unknown): boolean => (e as { status?: unknown } | null)?.status === 404;
const RETRY_TREE_MS = 5 * 60_000;

/** The loader of one process: after a 404, the gateway's walk is asked again only every few minutes. */
export function treeLoader(now: () => number = Date.now): (src: TreeSource) => Promise<DriveTree> {
  let skipUntil = 0;
  return async (src) => {
    if (now() >= skipUntil) {
      try {
        // The gateway counts from 0 (the root's content): its depth 2 is these three levels.
        return await src.tree(DRIVE_ROOT, TREE_DEPTH - 1);
      } catch (e) {
        if (!isNotFound(e)) throw e;
        skipUntil = now() + RETRY_TREE_MS;
      }
    }
    return walk(src);
  };
}

async function listRoot(src: TreeSource): Promise<FileEntry[]> {
  try {
    return await src.list(DRIVE_ROOT);
  } catch (e) {
    if (!isNotFound(e)) throw e;
    await src.makeDir(DRIVE_ROOT);
    return src.list(DRIVE_ROOT);
  }
}

async function walk(src: TreeSource): Promise<DriveTree> {
  const root = await listRoot(src);
  const entries: DriveTree["entries"] = root.map((e) => ({ ...e, depth: 0 }));
  let complete = true;
  let level = root;
  let listed = 1;
  for (let depth = 1; depth < TREE_DEPTH; depth++) {
    const folders = level.filter((e) => e.type === "directory" && !isMemoryFolder(e.name)).slice(0, MAX_FOLDERS - listed);
    if (!folders.length) break;
    listed += folders.length;
    const found = await runPool(folders, PARALLEL, (d) => src.list(d.path));
    level = [];
    for (const r of found) {
      if (r.status === "rejected") {
        complete = false;
        continue;
      }
      for (const e of r.value) {
        entries.push({ ...e, depth });
        level.push(e);
      }
    }
  }
  return { entries, complete };
}
