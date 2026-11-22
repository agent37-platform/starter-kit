// Google Sheets, Docs and Slides an Expert works in (Leslie, 31/10): they live in Google Drive, not in
// ~/Livrables, so the chat only had a link lost in an old message. Here: the documents a reply points
// to (one per file, whatever the link's form), the title to show, and the shortcut the Expert keeps
// in its drive for each one (« Suivi des candidatures.gsheet », the format of Google Drive for
// desktop: JSON with the url) so its Livrables tab lists them too. No imports: tested.

export type GoogleKind = "sheets" | "docs" | "slides";

export interface GoogleDoc {
  id: string;
  kind: GoogleKind;
  url: string;
  title: string;
  /** A name taken from the reply that gives the document, when nothing names it (Leslie, 19/11). */
  guess?: string;
}

export const GOOGLE_LABEL: Record<GoogleKind, string> = { sheets: "Google Sheets", docs: "Google Docs", slides: "Google Slides" };
/** The format in a word, under a document's name (« Slides, 11 h 42 »). */
export const SHORT_LABEL: Record<GoogleKind, string> = { sheets: "Sheets", docs: "Docs", slides: "Slides" };
/** What a document no text names is called (Leslie, 18/11: « tout s'appelle Google Slides »). */
export const UNNAMED: Record<GoogleKind, string> = { sheets: "Tableur sans nom", docs: "Document sans nom", slides: "Présentation sans nom" };

/** True when nothing gave the document a name (its title is still the format's). */
export const isUnnamed = (d: Pick<GoogleDoc, "kind" | "title">): boolean => d.title === GOOGLE_LABEL[d.kind];

/** The name shown: the member's own, else the one the text gave, else « Présentation sans nom ». */
export function docName(d: Pick<GoogleDoc, "id" | "kind" | "title" | "guess">, names: Readonly<Record<string, string>>): string {
  const own = names[d.id]?.trim();
  return own || (isUnnamed(d) ? d.guess || UNNAMED[d.kind] : d.title);
}

/**
 * A default name from the reply itself (Leslie, 19/11: « pas fan de Nommer, mets un nom par défaut par
 * rapport au contenu »): its first heading, else its first bold words, else its first sentence, cut at
 * 48 signs on a word. Links, emojis and « Voici » go; null when nothing is left worth a name.
 */
export function titleFromReply(text: string): string | null {
  const clean = (t: string) =>
    t
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\p{Extended_Pictographic}️?/gu, "")
      .replace(/[*_`#>]+/g, "")
      .replace(/^\s*(?:voici|voilà|c['’]est prêt|c['’]est fait|bonjour|parfait|super|ok)\b[\s,:!.]*/iu, "")
      .replace(/\s+/g, " ")
      .replace(/[\s:,;.!?-]+$/u, "")
      .trim();
  const heading = /^\s{0,3}#{1,4}\s+(.+)$/m.exec(text)?.[1];
  const bold = /\*\*([^*\n]{4,80})\*\*/.exec(text)?.[1];
  const sentence = text.split(/(?<=[.!?:])\s|\n/).map(clean).find((x) => x.split(" ").length >= 2);
  for (const c of [heading, bold, sentence]) {
    if (!c) continue;
    let t = clean(c);
    // « La présentation de 3 pages » parle du document sans le nommer.
    if (t.split(" ").length < 2 || /^(?:le|la|les|l['’]|un|une|des|ce|cette)\s*(?:document|doc|fichier|lien|présentation|tableur|tableau|classeur|slides?)\b/iu.test(t)) continue;
    if (t.length > 48) {
      const cut = t.slice(0, 48);
      t = cut.includes(",") ? cut.slice(0, cut.lastIndexOf(",")) : cut.replace(/\s+\S*$/u, "").replace(/\s+(?:à|de|du|des|la|le|les|et|en|pour|avec|sur)$/iu, "");
    }
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return null;
}

/** A rename kept: trimmed, at most 120 signs; empty gives the document its own name back. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Today's, yesterday's or the date's heading of a document last used at `ms` (null: « Plus ancien »). */
export function dayHeading(ms: number | null, now: Date = new Date()): string {
  if (!ms) return "Plus ancien";
  const d = new Date(ms);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  const date = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  if (diff === 0) return "Aujourd’hui";
  if (diff === 1) return `Hier, ${date}`;
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" }).replace(/^./, (c) => c.toUpperCase());
}

/** « 11 h 42 »: the day is the heading above. */
export function usedTime(ms: number | null): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")} h ${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The fold used to search a name: no accents, no case. */
export const foldName = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const PATH_KIND: Record<string, GoogleKind> = { spreadsheets: "sheets", document: "docs", presentation: "slides" };
const URL_RE = /https:\/\/docs\.google\.com\/(spreadsheets|document|presentation)\/d\/([A-Za-z0-9_-]{20,})[^\s)\]>"'«»]*/g;
const LINK_RE = /\[([^\]\n]+)\]\(<?(https:\/\/docs\.google\.com\/(?:spreadsheets|document|presentation)\/d\/[A-Za-z0-9_-]{20,}[^\s)>]*)>?\)/g;
// « 🔗 [Ouvrir le suivi des candidatures](https://docs.google.com/…) » alone on its line: the card
// under the reply says it, the line goes.
const ACTION_LINE = /^[^\S\n]*(?:[-*•][^\S\n]+)?(?:\p{Extended_Pictographic}️?[^\S\n]*)?\[(?:Ouvrir|Voir|Consulter|Accéder|Lien)\b[^\]\n]*\]\(<?https:\/\/docs\.google\.com\/(?:spreadsheets|document|presentation)\/d\/[^)\n]+\)[^\S\n]*$/gmu;

/** The Google document a url points to, or null. */
export function googleDocOf(url: string): Omit<GoogleDoc, "title"> | null {
  const m = new RegExp(URL_RE.source).exec(url);
  if (!m) return null;
  const kind = PATH_KIND[m[1]];
  return { id: m[2], kind, url: `https://docs.google.com/${m[1]}/d/${m[2]}/edit` };
}

/** « Ouvrir le suivi des candidatures » → « Suivi des candidatures »; null for a label that names nothing. */
export function titleFromLabel(label: string): string | null {
  const t = label
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*(?:ouvrir|voir|consulter|accéder\s+à|lien\s+vers)\s+(?:le\s+|la\s+|les\s+|l['’]\s*|au\s+|à\s+la\s+)?/i, "")
    .replace(/^(?:google\s+)?(?:sheets?|docs?|slides?|document|fichier|tableau|lien|ici)\s*$/i, "")
    .trim();
  if (t.length < 3 || /^https?:/i.test(t)) return null;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// A bare link names nothing (Leslie, 03/11: the card said « Google Docs »). The sentence before it often
// does: « …dans la présentation WhatsApp, pages 13 à 17 : https://… » → « Présentation WhatsApp ».
const NOUN = "présentation|document|doc|tableau|tableur|fichier|suivi|kit|deck|rapport|compte rendu|note|plan|fiche|guide|brief|feuille";
const NAMED_RE = new RegExp(`(?:^|[\\s(«"'’])(?:la|le|l['’]|du|de la|au|ce|cette|notre|votre|ton|ta|mon|ma)\\s*((?:${NOUN})\\b[^,:;.!?()\\n«»"]{0,48})`, "giu");

/** The title the text just before a bare link gives the document, or null. */
export function titleBefore(text: string, at: number): string | null {
  const start = Math.max(0, at - 200);
  let lineStart = text.lastIndexOf("\n", at - 1) + 1;
  // A link alone on its line belongs to the line above when that one ends on « : ».
  if (!text.slice(lineStart, at).trim() && /:\s*$/.test(text.slice(0, Math.max(0, lineStart - 1)))) lineStart = text.lastIndexOf("\n", lineStart - 2) + 1;
  const before = text.slice(Math.max(start, lineStart), at);
  let last: string | null = null;
  for (const m of before.matchAll(NAMED_RE)) last = m[1];
  if (!last) return null;
  const t = last.replace(/\s+(?:est|sont|se|qui|que|avec|dans|sur|pour|en|à|a)\b.*$/iu, "").replace(/\s+(?:pages?|p\.)\s*\d.*$/iu, "").trim();
  const words = t.split(/\s+/);
  // « le document » alone names nothing; « la présentation WhatsApp » does, « la présentation de 3 pages » does not.
  if (words.length < 2 || /^\p{L}+\s+(?:de|d['’]|en)\s*\d/u.test(t)) return null;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The Google documents a reply points to, in order, each once, with the best title its text gives. */
export function googleDocs(text: string): GoogleDoc[] {
  const found = new Map<string, GoogleDoc>();
  for (const m of text.matchAll(LINK_RE)) {
    const doc = googleDocOf(m[2]);
    if (!doc) continue;
    const title = titleFromLabel(m[1]);
    const had = found.get(doc.id);
    if (!had) found.set(doc.id, { ...doc, title: title ?? GOOGLE_LABEL[doc.kind] });
    else if (title && had.title === GOOGLE_LABEL[doc.kind]) had.title = title;
  }
  for (const m of text.matchAll(URL_RE)) {
    const doc = googleDocOf(m[0]);
    if (!doc) continue;
    const had = found.get(doc.id);
    const guess = titleBefore(text, m.index ?? 0);
    if (!had) found.set(doc.id, { ...doc, title: guess ?? GOOGLE_LABEL[doc.kind] });
    else if (guess && had.title === GOOGLE_LABEL[doc.kind]) had.title = guess;
  }
  const guess = titleFromReply(text);
  for (const d of found.values()) if (isUnnamed(d) && guess) d.guess = guess;
  return [...found.values()];
}

/** The reply without its « Ouvrir … » lines to Google documents, which become cards. */
export function withoutGoogleActions(text: string): string {
  return text.replace(ACTION_LINE, "").replace(/\n{3,}/g, "\n\n").trim();
}

// ── Shortcuts in the drive ────────────────────────────────────────────────────────────────────

const SHORTCUT_EXT: Record<string, GoogleKind> = { gsheet: "sheets", gdoc: "docs", gslides: "slides" };

/** The kind of a shortcut file (« Suivi.gsheet »), or null for any other file. */
export function shortcutKind(name: string): GoogleKind | null {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return SHORTCUT_EXT[ext] ?? null;
}

/** « Suivi des candidatures.gsheet » → « Suivi des candidatures ». */
export function shortcutTitle(name: string): string {
  return name.replace(/\.(gsheet|gdoc|gslides)$/i, "");
}

/** The document a shortcut file points to: `{"url": …}` (ours) or `{"doc_id": …}` (Google Drive for desktop). */
export function parseShortcut(name: string, body: string): GoogleDoc | null {
  const kind = shortcutKind(name);
  if (!kind) return null;
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const title = typeof o.title === "string" && o.title.trim() ? o.title.trim() : shortcutTitle(name);
  if (typeof o.url === "string") {
    const doc = googleDocOf(o.url);
    if (doc) return { ...doc, title };
  }
  if (typeof o.doc_id === "string" && /^[A-Za-z0-9_-]{20,}$/.test(o.doc_id)) {
    const path = { sheets: "spreadsheets", docs: "document", slides: "presentation" }[kind];
    return { id: o.doc_id, kind, url: `https://docs.google.com/${path}/d/${o.doc_id}/edit`, title };
  }
  return null;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ");

/**
 * The documents a discussion uses, the last one used first. A reply uses a document when it links to
 * it, or when it names one already linked by its title (« … à jour dans le suivi des candidatures »):
 * the Expert works on the same Sheet without repeating its link (Leslie, 31/10).
 */
export function usedGoogleDocs(replies: { text: string; at: number | null }[]): (GoogleDoc & { usedAt: number | null })[] {
  const seen = new Map<string, GoogleDoc & { usedAt: number | null }>();
  for (const { text, at } of replies) {
    const linked = googleDocs(text);
    const named = [...seen.values()].filter((d) => !d.title.startsWith("Google ") && d.title.split(" ").length > 1 && fold(text).includes(fold(d.title)));
    for (const d of [...named, ...linked]) {
      const had = seen.get(d.id);
      const title = had && d.title.startsWith("Google ") ? had.title : d.title;
      // The first reply that gave the document keeps naming it by default.
      const guess = had?.guess ?? d.guess;
      seen.delete(d.id);
      seen.set(d.id, { id: d.id, kind: d.kind, url: d.url, title, usedAt: at, ...(guess ? { guess } : {}) });
    }
  }
  return [...seen.values()].reverse();
}
