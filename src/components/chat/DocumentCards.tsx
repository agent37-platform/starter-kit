"use client";

import { isNumberCell, isTotalRow } from "@/lib/sheet-cells";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, File, Loader2, Palette, FileImage, FileSpreadsheet, FileText, Presentation, Video, Music, type LucideIcon } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { isMemoryFolder } from "@/lib/drive-order";
import type { DocKind, DriveFile, TurnDoc } from "@/lib/drive-links";
import type { FileListResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FilePreview, ReducedImage } from "@/components/files/FilePreview";
import { contentUrl, formatBytes, thumbUrl, type FileEntry } from "@/components/files/types";
import { fileLabel } from "@/lib/drive-paths";
import { cachedFetch, forget } from "@/lib/client-cache";
import type { MemoryList } from "@/lib/memory";
import { toast } from "sonner";

const KINDS: Record<DocKind, { label: string; icon: LucideIcon; tone: string }> = {
  pdf: { label: "PDF", icon: FileText, tone: "bg-[#FCE8E4] text-[#B4321F] dark:bg-[#3b2520] dark:text-[#f4a28c]" },
  excel: { label: "Excel", icon: FileSpreadsheet, tone: "bg-[#E3F4EA] text-[#137A4B] dark:bg-[#17332a] dark:text-[#7fd1a6]" },
  word: { label: "Word", icon: FileText, tone: "bg-[#E4ECFB] text-[#2E4EC4] dark:bg-[#1c2745] dark:text-[#9fb4f2]" },
  powerpoint: { label: "PowerPoint", icon: Presentation, tone: "bg-[#FDEEDF] text-[#B85A12] dark:bg-[#3a2a1a] dark:text-[#f3b47a]" },
  image: { label: "Image", icon: FileImage, tone: "bg-tint text-brand-ink" },
  video: { label: "Vidéo", icon: Video, tone: "bg-[#EBE8FD] text-[#5538EE] dark:bg-[#28214d] dark:text-[#b4a4fa]" },
  audio: { label: "Audio", icon: Music, tone: "bg-[#E3F2FD] text-[#1976D2] dark:bg-[#152a40] dark:text-[#90caf9]" },
  other: { label: "", icon: File, tone: "bg-soft-2 text-ink-2" },
};

// Past this size a document is not fetched for its preview: the format's thumbnail instead. A size
// the listing does not know is checked on the response itself (readCapped).
const MAX_PREVIEW_BYTES = 30 * 1024 * 1024;
// A workbook part is not inflated past this: a small file may unzip to hundreds of megabytes.
const MAX_XML_PART_BYTES = 20 * 1024 * 1024;

const ext = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");
const kindLabel = (doc: TurnDoc) => KINDS[doc.kind].label || ext(doc.name).toUpperCase() || "Fichier";

// The documents of one reply, as in a messaging app: each document seen first (its first page, its
// first rows, the start of its text, the picture itself), then its file line with « Télécharger ».
// A click on the preview opens it full size. Each renderer is loaded only when a document needs it.
export function DocumentCards({ agentId, docs }: { agentId: string; docs: TurnDoc[] }) {
  const [open, setOpen] = useState<FileEntry | null>(null);
  if (!docs.length) return null;
  return (
    <>
      <ul aria-label="Documents" className="mt-3 flex flex-col gap-4">
        {docs.map((d) => (
          <li key={d.path} className="min-w-0">
            <button
              type="button"
              aria-label={`Ouvrir ${d.name}`}
              onClick={() => setOpen({ name: d.name, path: d.path, type: "file", size: d.size, modified: d.modified ?? 0, hidden: false })}
              className="block h-60 w-full overflow-hidden rounded-2xl border border-line bg-soft text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 sm:h-80"
            >
              <Preview agentId={agentId} doc={d} />
            </button>
            <FileRow agentId={agentId} doc={d} />
            {isCharteDoc(d) && <CharteAdopt agentId={agentId} doc={d} />}
          </li>
        ))}
      </ul>
      <FilePreview agentId={agentId} entry={open} onClose={() => setOpen(null)} />
    </>
  );
}

function FileRow({ agentId, doc }: { agentId: string; doc: TurnDoc }) {
  const { icon: Icon, tone } = KINDS[doc.kind];
  const size = formatBytes(doc.size);
  return (
    <div className="mt-2 flex min-w-0 items-center gap-3 rounded-2xl border border-line bg-surface p-2.5 pl-3">
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", tone)}>
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 grow">
        <span title={fileLabel(doc)} className="block truncate text-[14px] font-semibold text-ink">
          {fileLabel(doc)}
        </span>
        <span className="block text-[12.5px] text-ink-3">{size ? `${kindLabel(doc)}, ${size}` : kindLabel(doc)}</span>
      </span>
      <Button asChild className="h-10 shrink-0 rounded-xl px-3 sm:px-4">
        <a href={contentUrl(agentId, doc.path, "attachment")} download={fileLabel(doc)} aria-label={`Télécharger ${fileLabel(doc)}`}>
          <Download /> <span className="hidden min-[400px]:inline">Télécharger</span>
        </a>
      </Button>
    </div>
  );
}

// A brand book an Expert delivered (« Charte graphique… », Koffi's /charte): whoever may deposit for the
// whole company makes it the company's in one click; the app copies it into the Contexte, as a new
// version when one is there (Leslie, 01/11: the Expert writes nothing in the memory himself).
export const isCharteDoc = (doc: { name: string }) => /charte\s+graphique/i.test(doc.name) && !/\.(gdoc|gsheet|gslides)$/i.test(doc.name);

export function CharteAdopt({ agentId, doc }: { agentId: string; doc: { name: string; path: string } }) {
  const [memory, setMemory] = useState<MemoryList | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    cachedFetch("memory-items", () => apiFetch<MemoryList>("/api/memory/items"), 60_000)
      .then(setMemory)
      .catch(() => setMemory(null));
  }, []);
  if (!memory?.canDepositForAll) return null;
  const current = memory.items.find((i) => i.kind === "document" && /charte/i.test(i.title));
  if (current?.fileName === doc.name && !done) return null;
  async function adopt() {
    setBusy(true);
    try {
      await apiFetch("/api/memory/charte", { method: "POST", body: JSON.stringify({ agentId, path: doc.path, replace: current?.id ?? null }) });
      forget("memory-items");
      setDone(true);
      toast.success("C’est la charte de l’entreprise : vos Experts l’appliquent désormais.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 rounded-2xl bg-tint px-3 py-2.5">
      <Palette className="size-5 shrink-0 text-brand-ink" />
      <span className="min-w-0 grow basis-40 text-[13.5px] text-ink-2">
        {done ? "Dans le Contexte : tous vos Experts l’appliquent." : "Pour que tous vos Experts l’appliquent :"}
      </span>
      {!done && (
        <Button size="sm" className="h-10 rounded-xl max-sm:w-full" disabled={busy} onClick={() => void adopt()}>
          {busy && <Loader2 className="animate-spin" />}
          En faire la charte de l’entreprise
        </Button>
      )}
    </div>
  );
}

// The format's own thumbnail: what is shown for anything without a renderer, while a preview
// loads, and whenever a preview fails (opened full size, it then says so and points at the download).
function FormatThumb({ doc, failed }: { doc: TurnDoc; failed?: boolean }) {
  const { icon: Icon, tone } = KINDS[doc.kind];
  return (
    <span className={cn("flex size-full flex-col items-center justify-center gap-3 px-6 text-center", tone)}>
      <Icon className="size-16" strokeWidth={1.3} />
      <span className="line-clamp-2 max-w-sm text-[14px] font-semibold">{fileLabel(doc)}</span>
      {failed && <span className="text-[13px] opacity-80">Aperçu indisponible. Téléchargez le fichier pour l’ouvrir.</span>}
    </span>
  );
}

/**
 * A document drawn as in the chat (first page, first rows, start of the text, first slide); its format
 * otherwise. `full`: opened from Livrables or from a card, the whole of it that can be read here (the
 * rows of the first sheet, the whole text, every slide), scrolling.
 */
export function Preview({ agentId, doc, full }: { agentId: string; doc: TurnDoc; full?: boolean }) {
  return <PreviewAt doc={doc} url={contentUrl(agentId, doc.path, "inline", doc.modified)} thumb={thumbUrl(agentId, doc.path, 960, doc.modified)} full={full} />;
}

/** `Preview` of a document read at `url` (a salon's signed address); `thumb`: a smaller image, when there is one. */
export function PreviewAt({ doc, url, thumb = url, full }: { doc: TurnDoc; url: string; thumb?: string; full?: boolean }) {
  const e = ext(doc.name);
  if ((doc.size ?? 0) > MAX_PREVIEW_BYTES) return <FormatThumb doc={doc} failed={full} />;
  if (doc.kind === "image") return <ImagePreview url={url} thumb={thumb} doc={doc} />;
  if (doc.kind === "video") {
    return (
      <div className="flex size-full items-center justify-center bg-black">
        <video
          src={url}
          controls
          playsInline
          className="size-full object-contain"
          preload="metadata"
        />
      </div>
    );
  }
  if (doc.kind === "audio") {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-3 bg-secondary/30 p-4">
        <Music className="size-12 text-ink-2" />
        <audio src={url} controls className="w-full max-w-xs" preload="metadata" />
      </div>
    );
  }
  if (doc.kind === "pdf") return <Lazy doc={doc} url={url} render={renderPdf} full={full} />;
  if (e === "xlsx" || e === "xlsm" || e === "csv") return <Lazy doc={doc} url={url} render={renderSheet} full={full} />;
  if (e === "docx") return <Lazy doc={doc} url={url} render={renderDocx} full={full} />;
  if (e === "pptx") return <Lazy doc={doc} url={url} render={renderPptx} full={full} />;
  return <FormatThumb doc={doc} failed={full} />;
}

function ImagePreview({ url, thumb, doc }: { url: string; thumb: string; doc: TurnDoc }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <FormatThumb doc={doc} />;
  return <ReducedImage thumb={thumb} original={url} alt={doc.name} onFail={() => setFailed(true)} className="size-full object-contain" />;
}

// `signal`: the preview left the screen; a renderer holding blob URLs gives them back.
type Render = (data: ArrayBuffer, doc: TurnDoc, width: number, full: boolean, signal: AbortSignal) => Promise<ReactNode>;

// The body of a preview's response, given up past MAX_PREVIEW_BYTES: on its announced length first,
// then while it streams in (a response without one).
async function readCapped(res: Response, abort: AbortController): Promise<ArrayBuffer> {
  if (Number(res.headers.get("content-length") ?? 0) > MAX_PREVIEW_BYTES) throw new Error("too large");
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PREVIEW_BYTES) {
      abort.abort();
      throw new Error("too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out.buffer;
}

// Fetches the document once it is on screen, then hands it to its renderer; the thumbnail stays
// while it loads and comes back if anything fails.
function Lazy({ doc, url, render, full = false }: { doc: TurnDoc; url: string; render: Render; full?: boolean }) {
  const box = useRef<HTMLSpanElement>(null);
  const [node, setNode] = useState<ReactNode | null>(null);
  const [failed, setFailed] = useState(false);
  // The reply's documents are rebuilt on every render: the effect follows the file, not the object.
  const docRef = useRef(doc);
  docRef.current = doc;
  const name = doc.name;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let alive = true;
    const abort = new AbortController();
    const go = async () => {
      try {
        const res = await fetch(url, { signal: abort.signal });
        if (!res.ok) throw new Error(String(res.status));
        const out = await render(await readCapped(res, abort), docRef.current, el.clientWidth || 600, full, abort.signal);
        if (alive) setNode(out);
      } catch {
        if (alive) setFailed(true);
      }
    };
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((x) => x.isIntersecting)) {
        seen.disconnect();
        void go();
      }
    });
    seen.observe(el);
    return () => {
      alive = false;
      abort.abort();
      seen.disconnect();
    };
  }, [url, name, render, full]);
  return (
    <span ref={box} className="block size-full">
      {node && !failed ? node : <FormatThumb doc={doc} failed={failed && full} />}
    </span>
  );
}

// --- PDF: the first page, drawn by pdf.js (loaded on demand, its worker beside it) ----------------

let pdfWorker: Worker | null = null;
const PDF_THUMB_MAX = 720;

const renderPdf: Render = async (data, _doc, width) => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfWorker) {
    pdfWorker = new Worker(new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
    pdfjs.GlobalWorkerOptions.workerPort = pdfWorker;
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  let src: string;
  let pages: number;
  // The document leaves the shared worker whether its page is drawn or not.
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    // A thumbnail: never drawn wider than a card on a sharp screen.
    const viewport = page.getViewport({ scale: (Math.min(width, PDF_THUMB_MAX) * ratio) / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;
    src = canvas.toDataURL("image/png");
    pages = pdf.numPages;
  } finally {
    void task.destroy();
  }
  return (
    <span className="relative block size-full bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element -- a page drawn here, as a data URL */}
      <img src={src} alt="" className="block w-full" />
      <span className="absolute right-3 top-3 rounded-full bg-black/65 px-2.5 py-1 text-[12px] font-semibold text-white">
        1/{pages} {pages > 1 ? "pages" : "page"}
      </span>
    </span>
  );
};

// --- Excel and CSV: the first rows of the first sheet, as a small table ----------------------------

const ROWS = 9;
const COLS = 7;
// Opened full size: enough of the sheet to read it, never a whole database.
const FULL_ROWS = 300;
const FULL_COLS = 26;

function Table({ sheet, rows, full }: { sheet: string | null; rows: string[][]; full?: boolean }) {
  const width = Math.min(full ? FULL_COLS : COLS, Math.max(1, ...rows.map((r) => r.length)));
  return (
    <span className="flex size-full flex-col bg-white text-[#1e1e28]">
      <span className={cn("min-h-0 flex-1", full ? "overflow-auto" : "overflow-hidden")}>
        <table className="w-full border-collapse text-[12.5px]">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={i === 0 ? "bg-[#E3F4EA] font-semibold" : i > 0 && isTotalRow(r) ? "bg-[#f6f6f9] font-semibold" : undefined}>
                {Array.from({ length: width }, (_, j) => (
                  <td key={j} className={cn("max-w-[12rem] truncate border border-[#e3e3ea] px-2 py-1.5", i > 0 && isNumberCell(r[j] ?? "") && "text-right tabular-nums")}>
                    {r[j] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </span>
      {sheet && <span className="shrink-0 border-t border-[#e3e3ea] bg-[#f6f6f9] px-3 py-1.5 text-[12px] font-semibold text-[#137A4B]">{sheet}</span>}
    </span>
  );
}

function parseCsv(text: string, max = ROWS): string[][] {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, max);
  const sep = (lines[0]?.match(/;/g)?.length ?? 0) > (lines[0]?.match(/,/g)?.length ?? 0) ? ";" : ",";
  return lines.map((line) => {
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = !quoted;
      } else if (c === sep && !quoted) {
        cells.push(cur);
        cur = "";
      } else cur += c;
    }
    cells.push(cur);
    return cells;
  });
}

// A workbook is a zip of XML parts: the first sheet's name and file, its shared strings, its rows.
// Read with jszip rather than SheetJS, whose npm release carries unfixed advisories.
const colIndex = (ref: string) => [...(ref.match(/^[A-Z]+/)?.[0] ?? "A")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

async function readXlsx(data: ArrayBuffer, maxRows = ROWS, maxCols = COLS): Promise<{ sheet: string | null; rows: string[][] }> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(data);
  const xml = async (path: string) => {
    const part = zip.file(path);
    // jszip's private `_data` holds the part's inflated size, read from the zip before inflating it.
    if (((part as unknown as { _data?: { uncompressedSize?: number } } | null)?._data?.uncompressedSize ?? 0) > MAX_XML_PART_BYTES) throw new Error("too large");
    const text = await part?.async("string");
    return text ? new DOMParser().parseFromString(text, "application/xml") : null;
  };
  const book = await xml("xl/workbook.xml");
  const first = book?.getElementsByTagName("sheet")[0];
  const rid = first?.getAttribute("r:id") ?? first?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  const rels = await xml("xl/_rels/workbook.xml.rels");
  const target = [...(rels?.getElementsByTagName("Relationship") ?? [])].find((r) => r.getAttribute("Id") === rid)?.getAttribute("Target") ?? "worksheets/sheet1.xml";
  const sheet = await xml(target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  if (!sheet) throw new Error("no sheet");
  const shared = [...((await xml("xl/sharedStrings.xml"))?.getElementsByTagName("si") ?? [])].map((si) => si.textContent ?? "");
  const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
  const rows = [...sheet.getElementsByTagName("row")].slice(0, maxRows).map((row) => {
    const cells: string[] = [];
    for (const c of row.getElementsByTagName("c")) {
      const j = colIndex(c.getAttribute("r") ?? "");
      if (j < 0 || j >= maxCols) continue;
      const type = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      if (type === "s") cells[j] = shared[Number(v)] ?? "";
      else if (type === "inlineStr") cells[j] = c.getElementsByTagName("is")[0]?.textContent ?? "";
      else cells[j] = type === "str" || type === "b" || !v || isNaN(Number(v)) ? v : number.format(Number(v));
    }
    return Array.from(cells, (x) => x ?? "");
  });
  return { sheet: first?.getAttribute("name") ?? null, rows };
}

const renderSheet: Render = async (data, doc, _width, full, signal) => {
  const [r, c] = full ? [FULL_ROWS, FULL_COLS] : [ROWS, COLS];
  // A workbook as Excel draws it: colours, logos, merged cells, every sheet (Leslie, 03/11). The plain
  // table of its values stays the fallback for a file this reader does not follow.
  if (ext(doc.name) !== "csv") {
    try {
      const { openBook, readSheet, releaseSheet, Workbook } = await import("./xlsx-book");
      const book = await openBook(data);
      if (book.sheets.length) {
        const sheet = await readSheet(book, 0, r, c);
        // Its pictures are blob URLs: given back unless the Workbook that revokes them is drawn.
        if (signal.aborted || !sheet.rows.length) releaseSheet(sheet);
        if (signal.aborted) throw new Error("left");
        if (sheet.rows.length) return <Workbook book={book} first={sheet} full={full} maxRows={r} maxCols={c} />;
      }
    } catch (e) {
      if ((e as Error).message === "too large") throw e;
    }
  }
  const { sheet, rows } = ext(doc.name) === "csv" ? { sheet: null, rows: parseCsv(new TextDecoder().decode(data), r) } : await readXlsx(data, r, c);
  if (!rows.length) throw new Error("empty");
  return <Table sheet={sheet} rows={rows} full={full} />;
};

// --- Word: the start of the text, kept to plain structure, fading out ------------------------------

const KEEP = new Set(["P", "H1", "H2", "H3", "H4", "STRONG", "B", "EM", "I", "UL", "OL", "LI", "TABLE", "TBODY", "TR", "TD", "TH", "BR"]);

// mammoth's HTML, reduced to text structure: no link, no picture, no attribute.
function cleanHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      walk(child);
      if (!KEEP.has(child.tagName)) child.replaceWith(...child.childNodes);
      else for (const a of [...child.attributes]) child.removeAttribute(a.name);
    }
  };
  const root = doc.body.firstElementChild!;
  walk(root);
  return root.innerHTML;
}

const renderDocx: Render = async (data, _doc, _width, full) => {
  const mammoth = await import("mammoth");
  // Pictures are dropped by cleanHtml anyway: not inlined as base64 in the first place.
  const { value } = await mammoth.convertToHtml({ arrayBuffer: data }, { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) });
  const html = cleanHtml(value);
  if (!html.trim()) throw new Error("empty");
  return (
    <span className={cn("relative block size-full bg-white px-6 py-5 text-[#1e1e28]", full ? "overflow-auto" : "overflow-hidden")}>
      <span
        className="block text-[13px] leading-relaxed [&_h1]:mb-2 [&_h1]:text-[18px] [&_h1]:font-bold [&_h2]:mb-1.5 [&_h2]:text-[15px] [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-2 [&_td]:border [&_td]:px-1.5"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {!full && <span aria-hidden className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white to-transparent" />}
    </span>
  );
};

// --- PowerPoint: each slide's text, title first, on a 16:9 card (the first one in the chat) --------


function Slide({ lines, n, of, badge = true }: { lines: string[]; n: number; of: number; badge?: boolean }) {
  const [title, ...rest] = lines;
  return (
    <span className="relative block aspect-video w-full overflow-hidden rounded-lg border border-[#e3e3ea] bg-white px-[6%] py-[5%] text-left text-[#1e1e28] shadow-sm">
      <span className="block text-[clamp(14px,2.2vw,22px)] font-bold leading-tight">{title ?? ""}</span>
      {rest.slice(0, 8).map((l, i) => (
        <span key={i} className="mt-1.5 block truncate text-[clamp(11px,1.4vw,14px)] text-[#4a4a58]">
          {l}
        </span>
      ))}
      {badge && (
        <span className="absolute bottom-2 right-3 text-[11px] font-semibold text-[#8a8a98]">
          {n}/{of}
        </span>
      )}
    </span>
  );
}

// Each slide drawn as it looks (pictures, text boxes, background); one with nothing drawable shows its text.
const renderPptx: Render = async (data, _doc, _width, full) => {
  const { readSlides, SlideDrawing, Slideshow, drawable } = await import("./pptx-slides");
  const slides = await readSlides(data, MAX_XML_PART_BYTES, full ? undefined : 1);
  const one = (i: number, badge = true) =>
    drawable(slides[i]) ? (
      <SlideDrawing key={i} slide={slides[i]} n={i + 1} of={slides.length} badge={badge} />
    ) : (
      <Slide key={i} lines={slides[i].lines} n={i + 1} of={slides.length} badge={badge} />
    );
  if (!full) return <span className="flex size-full items-center justify-center bg-[#FDEEDF] p-5">{one(0)}</span>;
  // Opened full size: the first slide large, the others one click or one arrow away.
  return <Slideshow count={slides.length} slide={(i) => one(i, false)} />;
};

// The expert's drive folder, and the subfolders changed since `since`, one level down: where the
// files written during a turn are looked for. Empty while nothing is asked or when the listing
// fails; then the cards come from the reply's text alone.
export function useDriveListing(agentId: string, folder: string | null | undefined, since: number | null, refreshKey: string): DriveFile[] {
  const [files, setFiles] = useState<DriveFile[]>([]);
  useEffect(() => {
    if (!folder || since == null) return;
    let alive = true;
    const list = (path: string) => apiFetch<FileListResponse>(`/api/agents/${agentId}/files/list?path=${encodeURIComponent(path)}`);
    (async () => {
      try {
        const root = await list(folder);
        const subs = root.entries.filter((e) => e.type === "directory" && !e.hidden && !isMemoryFolder(e.name) && e.modified >= since).slice(0, 8);
        const deeper = await Promise.allSettled(subs.map((d) => list(d.path)));
        const all: DriveFile[] = [...root.entries];
        for (const r of deeper) if (r.status === "fulfilled") all.push(...r.value.entries);
        if (alive) setFiles(all);
      } catch {
        if (alive) setFiles([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [agentId, folder, since, refreshKey]);
  return files;
}
