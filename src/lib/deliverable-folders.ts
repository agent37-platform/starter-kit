// Every deliverable of the drive in one list (Myriel, Leslie 30/10: « Voir tous les livrables »):
// what each Expert made, newest first, whoever made it. The drive is ~/Livrables/<Expert>/<sujet>:
// one row per subject (a folder, or a file left loose in the Expert's folder), with its owner's
// folder, how many files it holds and its latest change. What the member brought (« Reçus », the
// chat's attachments), the memory and the working files are not deliverables. No imports: tested.

export interface TreeEntry {
  name: string;
  path: string;
  type: string;
  modified: number;
  depth: number;
  hidden?: boolean;
}

export interface DeliverableItem {
  path: string;
  name: string;
  /** The Expert's folder it lies in (« Fatima »), as the drive names it. */
  owner: string;
  folder: boolean;
  /** Files inside a folder (as far as the tree was read); 1 for a loose file. */
  files: number;
  modified: number;
  /** A picture or a PDF inside, to show as its cover; the file itself for a loose one. */
  cover: string | null;
  /** The cover file's own change: its preview's address follows it, not the folder's latest change. */
  coverModified: number;
}

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^[._]+/, "");

// Not deliverables: what the member brought, the memory, the expert's working folders and files.
const NOT_DELIVERABLE_FOLDER = /^(recus|pieces jointes|memoire|memory|__pycache__|cache|caches|node_modules|tmp|temp|venv|apercus?|previews?|vignettes?|thumbnails?|miniatures?)$/;
const WORKING_FILE = /\.(md|markdown|srt|vtt|py|pyc|js|mjs|cjs|ts|sh|json|jsonl|yaml|yml|toml|log|lock|env|ini|cfg|sqlite|db|tmp|bak)$/;
// What a deliverable can show as its cover, best first: a picture, a video's first frame, then a PDF's, a slide's, a page's or a sheet's
// first view (Leslie, 16/11: « les PDF, les PPT, les Word, pas juste les PNG »). The app draws the last four itself.
const COVER_RANK: [RegExp, number][] = [
  [/\.(png|jpe?g|webp|gif|avif)$/i, 6],
  [/\.(mp4|webm|mov)$/i, 5],
  [/\.pdf$/i, 4],
  [/\.pptx$/i, 3],
  [/\.docx$/i, 2],
  [/\.(xlsx|xlsm|csv)$/i, 1],
];
/** How good a cover this file makes, 0 when it has none to show. */
export const coverRank = (name: string): number => COVER_RANK.find(([re]) => re.test(name))?.[1] ?? 0;

const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

/** The deliverables of a drive tree, newest change first. */
export function deliverableItems(entries: readonly TreeEntry[]): DeliverableItem[] {
  const skipped = (e: TreeEntry) =>
    e.hidden || (e.type === "directory" ? NOT_DELIVERABLE_FOLDER.test(plain(e.name)) : WORKING_FILE.test(plain(e.name)));
  const owners = new Map(entries.filter((e) => e.depth === 0 && e.type === "directory" && !skipped(e)).map((e) => [e.path, e.name]));
  const items = new Map<string, DeliverableItem>();
  for (const e of entries) {
    if (e.depth !== 1 || skipped(e)) continue;
    const owner = owners.get(parentOf(e.path));
    if (!owner) continue;
    const folder = e.type === "directory";
    items.set(e.path, {
      path: e.path,
      name: e.name,
      owner,
      folder,
      files: folder ? 0 : 1,
      modified: e.modified || 0,
      cover: !folder && coverRank(e.name) ? e.path : null,
      coverModified: !folder && coverRank(e.name) ? e.modified || 0 : 0,
    });
  }
  // What lies inside a subject folder, as deep as the tree went: counted, dated, a cover picked.
  for (const e of entries) {
    if (e.depth < 2 || e.type === "directory" || skipped(e)) continue;
    // The subject folder is the ancestor `depth - 1` levels up: one lookup, not a scan per file.
    const parts = e.path.split("/");
    const top = items.get(parts.slice(0, parts.length - (e.depth - 1)).join("/"));
    if (!top?.folder) continue;
    const below = e.path.slice(top.path.length + 1).split("/");
    if (below.slice(0, -1).some((part) => NOT_DELIVERABLE_FOLDER.test(plain(part)))) continue;
    top.files += 1;
    top.modified = Math.max(top.modified, e.modified || 0);
    // A picture beats a PDF, a PDF a slide deck, and so on: the first of the best kind stays.
    if (coverRank(e.name) > (top.cover ? coverRank(top.cover) : 0)) {
      top.cover = e.path;
      top.coverModified = e.modified || 0;
    }
  }
  return [...items.values()].sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name, "fr"));
}
