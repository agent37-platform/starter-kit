// Shared client-side helpers for the Files tab. The wire shapes (FileEntry / FileListResponse)
// live in lib/types.ts so the server (lib/agent37.ts) and the browser agree on one definition.
import { DRIVE_ABS, DRIVE_ROOT, seatFolderOf } from "../../lib/drive-paths.ts";
import type { FileEntry } from "../../lib/types.ts";

export type { FileEntry, FileListResponse } from "../../lib/types.ts";

export function isDir(entry: FileEntry): boolean {
  return entry.type === "directory";
}

// Join a directory path and a basename, tolerating a trailing slash (e.g. the "/" root).
export function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

// Human-readable size. Directories carry a null size and render blank.
export function formatBytes(size: number | null): string {
  if (size == null) return "";
  if (size < 1024) return `${size} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let n = size / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 ? n.toFixed(1).replace(".", ",") : Math.round(n)} ${units[i]}`;
}

// `modified` is epoch milliseconds (Agent API convention).
export function formatMtime(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

// One clickable breadcrumb: a label plus the path it navigates to. The trail starts at the drive
// ("Livrables"), never above it: what lies above (/home/node) is refused by every files route, so
// a crumb for it would only lead to an error.
export function breadcrumbs(path: string): { label: string; path: string }[] {
  const root = [DRIVE_ABS, DRIVE_ROOT].find((r) => path === r || path.startsWith(`${r}/`));
  if (!root) return [];
  const parts = path.slice(root.length).split("/").filter(Boolean);
  const seat = seatFolderOf(parts);
  if (seat) parts.shift();
  let acc = seat ? `${root}/${seat}` : root;
  const crumbs: { label: string; path: string }[] = [{ label: seat ? "Mes livrables" : "Livrables", path: acc }];
  for (const part of parts) {
    acc += `/${part}`;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}

// How the preview dialog should render a file, chosen by extension. CRITICAL: html/svg are
// "sandbox" — they must only ever be rendered inside a sandboxed <iframe> (scripts neutralised),
// never inline on the app origin. Plain text/code is fetched and shown escaped in a <pre>.
export type PreviewKind = "image" | "pdf" | "sandbox" | "text" | "video" | "audio" | "none";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"];
const VIDEO_EXTS = ["mp4", "webm", "ogg", "mov", "m4v"];
const AUDIO_EXTS = ["mp3", "wav", "m4a", "aac", "flac", "oga"];
// Anything that could execute or render as an active document on our origin: render sandboxed.
const SANDBOX_EXTS = ["svg", "html", "htm", "xhtml"];
const TEXT_EXTS = [
  "txt", "md", "markdown", "json", "jsonl", "ndjson", "csv", "tsv", "log", "yaml", "yml",
  "xml", "ini", "toml", "env", "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rb", "go",
  "rs", "java", "kt", "c", "h", "cc", "cpp", "hpp", "cs", "php", "swift", "sh", "bash",
  "zsh", "fish", "sql", "css", "scss", "sass", "less", "conf", "cfg", "gitignore", "dockerfile",
];

export function previewKind(name: string): PreviewKind {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (IMAGE_EXTS.includes(ext)) return "image";
  if (VIDEO_EXTS.includes(ext)) return "video";
  if (AUDIO_EXTS.includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (SANDBOX_EXTS.includes(ext)) return "sandbox";
  if (TEXT_EXTS.includes(ext)) return "text";
  return "none";
}

// The browser never holds the sk_live_ key — preview/download point at the BFF content route,
// which streams the bytes server-side with the key attached.
/** `modified` versions it, as thumbUrl: the browser then keeps that version a day. */
export function contentUrl(agentId: string, path: string, disposition: "inline" | "attachment", modified?: number | null): string {
  const v = modified ? `&v=${Math.trunc(modified)}` : "";
  return `/api/agents/${agentId}/files/content?path=${encodeURIComponent(path)}&disposition=${disposition}${v}`;
}

/** A reduced copy of a drive picture (thumb route); `modified` versions it so the browser keeps it. */
export function thumbUrl(agentId: string, path: string, width: number, modified?: number | null): string {
  const v = modified ? `&v=${Math.trunc(modified)}` : "";
  return `/api/agents/${agentId}/files/thumb?path=${encodeURIComponent(path)}&w=${width}${v}`;
}

// Folder download → the BFF archive route streams a .tar.gz of the directory (key attached
// server-side), so an <a download> can point straight at it, like contentUrl for single files.
export function archiveUrl(agentId: string, path: string): string {
  return `/api/agents/${agentId}/files/archive?path=${encodeURIComponent(path)}`;
}
