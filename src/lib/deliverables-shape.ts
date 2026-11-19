// The mobile app's deliverables list, built from the drive tree in the exact shape and with the exact rules of
// the back office's `GET /api/v1/app/deliverables` (control-plane `modules/app-api/deliverables.ts`): same
// ids, same experts, same folders. Pure, so the parity is tested. Contract: docs/plans/mobile-par-la-passerelle.md.
import { createHash } from "node:crypto";
import type { DriveTree } from "./drive-paths.ts";

export type DeliverableKind = "pdf" | "xlsx" | "docx" | "pptx" | "image" | "link" | "other";
export interface Deliverable {
  id: string;
  expertId: string;
  title: string;
  kind: DeliverableKind;
  updatedAt: string;
  url: string | null;
  folder: string;
}

type Entry = DriveTree["entries"][number];
type Dir = { path: string; depth: number; expert: string | null; base: string };

const ROOT = "Livrables";
const MAX_LISTINGS = 80;
const MAX_ITEMS = 500;
const MAX_DEPTH = 4;
const KINDS: Record<string, DeliverableKind> = {
  pdf: "pdf", xlsx: "xlsx", xls: "xlsx", csv: "xlsx", docx: "docx", doc: "docx", pptx: "pptx", ppt: "pptx",
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image", svg: "image", url: "link", webloc: "link",
};
const WORKING_FILE = /\.(md|markdown|srt|vtt|py|pyc|js|mjs|ts|sh|json|jsonl|yaml|yml|toml|log|lock|env|ini|cfg|sqlite|db|tmp|bak)$/i;
const MEMORY_DIR = /^(m[eé]moire|memory)$/i;

const kindOf = (name: string): DeliverableKind => KINDS[/\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? ""] ?? "other";
const isoOf = (modified: number): string => new Date(modified > 1e12 ? modified : modified * 1000).toISOString();
const fold = (v: string): string => v.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’'`]/g, " ").toLowerCase().trim();
const keyOf = (profile: string): string => (profile.includes("__") ? profile.slice(profile.lastIndexOf("__") + 2) : profile);

export function expertOfFolder(folder: string, profiles: readonly string[]): string {
  const f = fold(folder);
  const p = profiles.find((x) => fold(x) === f || fold(keyOf(x)) === f);
  return p ? keyOf(p) : f;
}

/** A file under `Livrables/<Expert>/`, no empty, hidden, `_…` or `..` segment: what a signed link may name. */
export function insideLivrables(path: string): boolean {
  const parts = path.split("/");
  return parts[0] === ROOT && parts.length >= 3 && !parts.some((x) => !x || x === "." || x === ".." || x.startsWith(".") || x.startsWith("_"));
}

/** `Livrables/…` for a tree path (`/home/node/Livrables/…`, `~/Livrables/…`); null outside the drive. */
export function relativeOf(path: string): string | null {
  const m = /^(?:\/home\/node\/|~\/)?(Livrables(?:\/.*)?)$/.exec(path);
  return m ? m[1] : null;
}

/** The deliverables of `tree`, newest first. `only`: the one folder a seat reads. `link`: a file's address. */
export function deliverablesFromTree(tree: DriveTree, opts: { profiles: readonly string[]; only: string | null; link: (path: string) => string | null }): Deliverable[] {
  const children = new Map<string, Entry[]>();
  for (const e of tree.entries) {
    const rel = relativeOf(e.path);
    const parent = rel?.slice(0, rel.lastIndexOf("/"));
    if (!parent) continue;
    const list = children.get(parent) ?? [];
    list.push(e);
    children.set(parent, list);
  }
  const { profiles, only } = opts;
  const start = only ? `${ROOT}/${only}` : ROOT;
  const items: Deliverable[] = [];
  let level: Dir[] = [{ path: start, depth: only ? 1 : 0, expert: only ? expertOfFolder(only, profiles) : null, base: start }];
  let listings = 0;
  while (level.length && listings < MAX_LISTINGS && items.length < MAX_ITEMS) {
    const next: Dir[] = [];
    for (const dir of level.slice(0, MAX_LISTINGS - listings)) {
      if (items.length >= MAX_ITEMS) break;
      listings += 1;
      collect(dir, children.get(dir.path) ?? [], profiles, opts.link, items, next);
    }
    level = next;
  }
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAX_ITEMS);
}

function collect(dir: Dir, entries: Entry[], profiles: readonly string[], link: (path: string) => string | null, items: Deliverable[], next: Dir[]): void {
  for (const e of entries) {
    if (e.hidden || e.name.startsWith(".") || e.name.startsWith("_") || e.name === "__pycache__") continue;
    const path = `${dir.path}/${e.name}`;
    if (e.type === "directory") {
      if (MEMORY_DIR.test(e.name.normalize("NFC"))) continue;
      if (dir.depth + 1 < MAX_DEPTH) next.push({ path, depth: dir.depth + 1, expert: dir.expert ?? expertOfFolder(e.name, profiles), base: dir.expert ? dir.base : path });
      continue;
    }
    if (e.type !== "file" || !dir.expert || WORKING_FILE.test(e.name)) continue;
    items.push({
      id: createHash("sha256").update(path).digest("hex").slice(0, 16), expertId: dir.expert, title: e.name, kind: kindOf(e.name),
      updatedAt: isoOf(e.modified), url: link(path), folder: dir.path.slice(dir.base.length + 1),
    });
  }
}
