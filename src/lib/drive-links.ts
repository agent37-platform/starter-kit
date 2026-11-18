// The drive files an expert's reply points to, and those it wrote during the turn: what the chat
// shows as document cards under the reply. Pure: the chat's Markdown (download links) and its
// cards share these patterns.
import { isMemoryFolder } from "./drive-order.ts";
import { isMemberUpload } from "./drive-paths.ts";

const DRIVE_PATH = String.raw`(?:/home/node|~)/Livrables/[^\s)\]\x60]+\.[A-Za-z0-9]{1,6}`;
// Experts also write the path from the drive itself (« Livrables/Djeneba/Reunions/cr.md », Leslie
// 28/10): bare in the text or in backticks, it is a link too.
const DRIVE_PATH_ANY = String.raw`(?:(?:/home/node|~)/)?Livrables/[^\s)\]\x60«»"]+\.[A-Za-z0-9]{1,6}`;
// GPT models prefix the path with `sandbox:` (ChatGPT's own download links); it is dropped.
// [label](file:///home/node/Livrables/…), [label](sandbox:/home/node/Livrables/…) or [label](~/Livrables/…)
export const LINKED = new RegExp(String.raw`\]\((?:file://|sandbox:)?(${DRIVE_PATH})\)`, "g");
// [label](<file:///home/node/Livrables/…>): the angle-bracket form, where the path may hold spaces
export const ANGLED = new RegExp(String.raw`\]\(<(?:file://|sandbox:)?((?:/home/node|~)/Livrables/[^>\n]+\.[A-Za-z0-9]{1,6})>\)`, "g");
// `~/Livrables/Fatima/post.docx` or a bare path in the text
export const CODE = new RegExp("`(?:sandbox:)?((?:(?:/home/node|~)/)?Livrables/[^`\\n]+\\.[A-Za-z0-9]{1,6})`", "g");
export const BARE = new RegExp(String.raw`(^|[\s(«"])(?:sandbox:)?(${DRIVE_PATH_ANY})`, "gm");

// A drive FOLDER the Expert cites (« Dossier local : `Livrables/Fatima/tajplast/flyers-modernes/` »),
// with or without `~/` or `/home/node/`: in backticks when its last part has no extension, bare in
// the text only with its closing slash (a bare name without one could be a file).
const FOLDER = String.raw`(?:(?:/home/node|~)/)?Livrables(?:/[^\s/)\]\x60«»"]+)+`;
// In backticks a folder name may hold spaces (« Pièces jointes »).
export const FOLDER_CODE = new RegExp("`(?:sandbox:)?((?:(?:/home/node|~)/)?Livrables(?:/[^/`\\n]+)+)/?`", "g");
export const FOLDER_BARE = new RegExp(String.raw`(^|[\s(«"])(${FOLDER})/(?=[\s).,;:!?»"]|$)`, "gm");

/** `~/Livrables/…` for a cited folder, or null when it names a file (its last part has an extension). */
export function citedFolder(path: string): string | null {
  const clean = safeDecode(path).replace(/\/+$/, "");
  if (/\.[A-Za-z0-9]{1,6}$/.test(clean.split("/").pop() ?? "")) return null;
  if (clean.split("/").some(isMemoryFolder)) return null;
  return clean.replace(/^(?:\/home\/node\/|~\/)?Livrables/, "~/Livrables");
}

export function safeDecode(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

/** One spelling per file: `~/Livrables/…`, decoded. */
export function normDrivePath(path: string): string {
  return safeDecode(path).replace(/^(?:\/home\/node\/)?Livrables(?=\/|$)/, "~/Livrables");
}

// The Experts also give a deliverable as an address of the app (« https://<client>.app.yelema.ai/livrables/ouvrir?p=… »,
// made for Telegram): in the chat it is that file.
export const OPEN_ADDRESS = /(?:https?:\/\/[^\s)<>\]]+)?\/livrables\/ouvrir\?p=[^\s)<>»\]]+/g;

/** An address of /livrables/ouvrir?p=… (on any host), as the drive path it names; null for any other address. */
export function openTarget(href: string): { path: string; file: boolean } | null {
  let url: URL;
  try {
    url = new URL(href, "http://x");
  } catch {
    return null;
  }
  if (url.pathname !== "/livrables/ouvrir") return null;
  const raw = url.searchParams.get("p")?.trim();
  if (!raw) return null;
  const path = normDrivePath(raw);
  if (!/^~\/Livrables\//.test(path) || path.split("/").includes("..")) return null;
  // A file has an extension; a folder opens in Livrables.
  return { path, file: /\.[a-z0-9]{1,6}$/i.test(path.split("/").pop() ?? "") };
}

/** The drive files a text names, in the order it names them, each once. */
export function drivePathsIn(text: string): string[] {
  const found: { at: number; path: string }[] = [];
  for (const m of text.matchAll(OPEN_ADDRESS)) {
    const t = openTarget(m[0]);
    if (t?.file) found.push({ at: m.index ?? 0, path: t.path });
  }
  for (const re of [ANGLED, LINKED, CODE]) for (const m of text.matchAll(re)) found.push({ at: m.index ?? 0, path: m[1] });
  for (const m of text.matchAll(BARE)) found.push({ at: (m.index ?? 0) + m[1].length, path: m[2] });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { path } of found.sort((a, b) => a.at - b.at)) {
    const p = normDrivePath(path);
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

export type DocKind = "pdf" | "excel" | "word" | "powerpoint" | "image" | "video" | "audio" | "other";

export function docKind(name: string): DocKind {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (ext === "pdf") return "pdf";
  if (["xls", "xlsx", "xlsm", "csv", "ods"].includes(ext)) return "excel";
  if (["doc", "docx", "odt", "rtf"].includes(ext)) return "word";
  if (["ppt", "pptx", "odp", "key"].includes(ext)) return "powerpoint";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"].includes(ext)) return "image";
  if (["mp4", "webm", "ogg", "mov", "m4v"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "aac", "flac"].includes(ext)) return "audio";
  return "other";
}

export interface DriveFile {
  name: string;
  path: string;
  type: string;
  size: number | null;
  modified: number;
  hidden?: boolean;
}

export interface TurnDoc {
  name: string;
  path: string;
  size: number | null;
  modified: number | null;
  kind: DocKind;
}

const DOCUMENT_KINDS = new Set<DocKind>(["pdf", "word", "excel", "powerpoint", "video"]);

const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

/**
 * The cards of one reply: the files its text names first, then the deliverables its own turn wrote
 * (`written`: as the runtime's history reports them, and the reply's MEDIA tags), each once. Never a file written by another
 * conversation at the same time. Memory, notes and technical files get no card. A named file missing
 * from a folder the listing covers does not exist (a path the expert made up): no card for it.
 */
/** Working files (data, code, logs, subtitle tracks) are the Expert's own kitchen, never a deliverable shown under a reply. */
const TECHNICAL = /\.(srt|vtt|json|jsonl|py|js|mjs|ts|sh|yaml|yml|toml|log|lock|env|ini|cfg|pyc|sqlite|db|ttf|otf|woff2?|eot)$/i;
/** A pattern the Expert wrote (« *.ttf »), never a real file name. */
const PATTERN = /[*?[\]{}]/;
export const isTechnicalFile = (name: string) => TECHNICAL.test(name);

/** Never a card nor a link in the chat: working files, notes (.md, .txt: Leslie, 27/10) and anything in the memory folder. */
export const isHiddenInChat = (path: string) =>
  isTechnicalFile(path) || PATTERN.test(path.split("/").pop() ?? "") || /\.(md|markdown|txt)$/i.test(path) || path.split("/").slice(0, -1).some(isMemoryFolder);

/** How many deliverables an Expert has made in its folder: no folder, nothing the member brought, no working file. */
export function deliverableCount(entries: readonly { path: string; type: string }[], folder: string): number {
  const inside = `${folder.replace(/\/+$/, "")}/`;
  return entries.filter((e) => e.type === "file" && e.path.startsWith(inside) && !isMemberUpload(e.path) && !isHiddenInChat(e.path)).length;
}

/**
 * A note the Expert names (a meeting report in .md, Leslie 28/10: « dès qu'on clique dessus, on retrouve
 * le livrable »): no card, but its name opens its folder in Livrables. `~/Livrables/…` of that folder,
 * or null for anything else (a document has its download link, memory and working files stay unlinked).
 */
export function noteFolder(path: string): string | null {
  const p = normDrivePath(path);
  if (!/\.(md|markdown|txt)$/i.test(p) || isTechnicalFile(p) || p.split("/").slice(0, -1).some(isMemoryFolder)) return null;
  return citedFolder(parentOf(p));
}

export function turnDocs(text: string, listing: readonly DriveFile[], written: readonly string[] = []): TurnDoc[] {
  const byPath = new Map(listing.map((f) => [normDrivePath(f.path), f]));
  const listed = new Set([...byPath.keys()].map(parentOf));
  const out: TurnDoc[] = [];
  const seen = new Set<string>();
  const add = (path: string, f?: DriveFile) => {
    if (seen.has(path) || isHiddenInChat(path)) return;
    seen.add(path);
    const name = path.split("/").pop() ?? path;
    out.push({ name, path, size: f?.size ?? null, modified: f?.modified ?? null, kind: docKind(name) });
  };
  for (const p of drivePathsIn(text)) if (byPath.has(p) || !listed.has(parentOf(p))) add(p, byPath.get(p));
  const named = out.length;
  for (const w of written) {
    const p = normDrivePath(w.startsWith("Livrables/") ? `~/${w}` : w);
    add(p, byPath.get(p));
  }
  // A reply that delivers a document (PDF, Word, Excel, PowerPoint, video): the pictures the turn wrote
  // beside it without naming them are what it was made with (a logo fetched to brand it), not
  // deliverables (Leslie, 18/11). The same name twice (a copy in another folder) is one card.
  const delivers = out.some((d) => DOCUMENT_KINDS.has(d.kind));
  const names = new Set<string>();
  return out.filter((d, i) => {
    if (delivers && d.kind === "image" && i >= named) return false;
    if (names.has(d.name)) return false;
    names.add(d.name);
    return true;
  });
}
