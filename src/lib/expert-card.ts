// The expert's profile panel beside its chat (Team design export, Myriel's choice A, Leslie 18/11): its last
// deliverables, the lines of its card and what « Partager » hands on. Pure, so `node --test` runs it as is.
import { isHiddenInChat } from "./drive-links.ts";
import { isMemberUpload } from "./drive-paths.ts";

export interface PanelFile {
  name: string;
  path: string;
  modified: number;
}

/** The expert's last `n` deliverables in its folder, newest first: no folder, nothing the member brought, no working file, nothing archived. */
export function lastDeliverables(entries: readonly { name: string; path: string; type: string; modified?: number | null; hidden?: boolean }[], folder: string, n = 4): PanelFile[] {
  const inside = `${folder.replace(/\/+$/, "")}/`;
  return entries
    .filter((e) => e.type === "file" && !e.hidden && e.path.startsWith(inside) && !isMemberUpload(e.path) && !isHiddenInChat(e.path) && !/(^|\/)Archivées\//i.test(e.path))
    .map((e) => ({ name: e.name, path: e.path, modified: e.modified ?? 0 }))
    .sort((a, b) => b.modified - a.modified)
    .slice(0, n);
}

const KIND: Record<string, string> = {
  pdf: "PDF", doc: "Word", docx: "Word", xls: "Excel", xlsx: "Excel", csv: "Tableur", ppt: "Présentation", pptx: "Présentation",
  gsheet: "Google Sheets", gdoc: "Google Docs", gslides: "Google Slides", html: "Page", png: "Image", jpg: "Image", jpeg: "Image", webp: "Image",
  mp3: "Audio", m4a: "Audio", wav: "Audio", mp4: "Vidéo",
};

/** « Présentation » for a .pptx, else the extension. */
export function fileKind(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return KIND[ext] ?? (ext ? ext.toUpperCase() : "Fichier");
}

/** « aujourd’hui », « hier », « lun. », « 12 nov. »: when a file or a call was last touched. */
export function shortWhen(ms: number, now: Date = new Date()): string {
  if (!ms) return "";
  const d = new Date(ms);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff <= 0) return "aujourd’hui";
  if (diff === 1) return "hier";
  if (diff < 7) return d.toLocaleDateString("fr-FR", { weekday: "short" });
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** A word as the card's machine-readable lines write it: capitals, no accent, « < » for a space. */
const mrzWord = (s: string): string =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9]+/g, "<").replace(/^<+|<+$/g, "");

/** « 14/10/2026 » ; null when the date is absent or unreadable. */
export function hiredOn(iso: string | null): string | null {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Africa/Abidjan" }) : null;
}

/** The card's three lines of 44 signs, from what is known of the expert. */
export function cardLines(f: { name: string; company: string | null; team: string | null; role: string | null; key: string }): string[] {
  const pad = (s: string) => s.padEnd(44, "<").slice(0, 44);
  const id = mrzWord(f.key).replace(/</g, "");
  return [
    pad(`YLMEXP${mrzWord(f.name)}<<${id}`),
    pad(`${mrzWord(f.company ?? "")}<<${mrzWord(f.team ?? "")}`),
    pad(`${mrzWord(f.name)}<<${mrzWord(f.role ?? "")}`),
  ];
}

/** What « Partager » hands on: who the expert is and how to write to it. */
export function shareCardText(f: { name: string; role: string | null; company: string | null; email: string | null }): string {
  return [`${f.name}${f.role ? `, ${f.role}` : ""}`, f.company ? `Expert Yelema chez ${f.company}` : "Expert Yelema", f.email].filter(Boolean).join("\n");
}
