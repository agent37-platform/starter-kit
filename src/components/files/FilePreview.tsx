"use client";

import { useEffect, useRef, useState, type TouchEvent } from "react";
import { Download, ExternalLink, Loader2, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useExpertsContext } from "@/components/experts/ExpertsProvider";
import { agentTabPath } from "@/lib/expert-tabs";
import { fileLabel, seatFolderOf } from "@/lib/drive-paths";
import type { Expert } from "@/lib/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CharteAdopt, isCharteDoc, Preview as DocPreview } from "@/components/chat/DocumentCards";
import { docKind, normDrivePath } from "@/lib/drive-links";
import { DOC_TONE, usePreviewSiblings } from "./preview-siblings";
import { cn } from "@/lib/utils";
import { contentUrl, formatBytes, previewKind, thumbUrl, type FileEntry } from "./types";
import { Markdown } from "@/components/chat/Markdown";
import { GoogleTile } from "@/components/chat/GoogleDocs";
import { GOOGLE_LABEL, parseShortcut, shortcutKind, type GoogleDoc } from "@/lib/google-docs";

// Preview one file in a dialog. Rendering is chosen by extension:
//  - image  -> <img> of a reduced copy, the original one click away (an <img> never runs script)
//  - pdf    -> the browser's PDF viewer in an <iframe>
//  - text   -> fetched and shown escaped in a <pre>
//  - sandbox (html/svg) -> a SANDBOXED <iframe> with all permissions stripped, so embedded
//    scripts can't run and can't reach this origin's session — the XSS guard for active documents
//  - Word, Excel, PowerPoint -> read in the page (DocumentCards' renderers, in full)
//  - Google shortcut (.gsheet, .gdoc, .gslides) -> the document's name and a button to open it in Google
//  - none   -> no inline preview; offer the download instead
export function FilePreview({
  agentId,
  entry,
  onClose,
}: {
  agentId: string;
  entry: FileEntry | null;
  onClose: () => void;
}) {
  // A pill picked at the top of the preview shows that file instead, until another file is opened.
  const siblings = usePreviewSiblings();
  const [pick, setPick] = useState<{ from: string; entry: FileEntry } | null>(null);
  if (pick && pick.from !== entry?.path) setPick(null);
  const asked = entry;
  entry = entry && pick?.from === entry.path ? pick.entry : entry;
  const current = entry ? normDrivePath(entry.path) : "";
  const pills = asked && siblings.length > 1 && siblings.some((d) => normDrivePath(d.path) === normDrivePath(asked.path)) ? siblings : [];
  const open = !!entry;
  // From one deliverable to the next without the pills: arrow keys on a computer, a swipe on a phone.
  const at = pills.findIndex((d) => normDrivePath(d.path) === current);
  const go = (step: number) => {
    const d = pills[at + step];
    if (!asked || at < 0 || !d) return;
    setPick({ from: asked.path, entry: { name: d.name, path: d.path, type: "file", size: d.size, modified: d.modified ?? 0, hidden: false } });
  };
  const goRef = useRef(go);
  goRef.current = go;
  const hasPills = pills.length > 1;
  useEffect(() => {
    if (!open || !hasPills) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.altKey || e.ctrlKey || e.metaKey || t?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "ArrowRight") goRef.current(1);
      else if (e.key === "ArrowLeft") goRef.current(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hasPills]);
  useEffect(() => {
    document.querySelector<HTMLElement>('[data-preview-pill="on"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current]);
  const touch = useRef<{ x: number; y: number; t: EventTarget | null } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    touch.current = hasPills ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: e.target } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const s0 = touch.current;
    touch.current = null;
    if (!s0) return;
    const dx = e.changedTouches[0].clientX - s0.x;
    const dy = e.changedTouches[0].clientY - s0.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    // A table wider than the panel scrolls sideways: its swipe is for it.
    for (let el = s0.t as HTMLElement | null; el && el !== e.currentTarget; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return;
    }
    go(dx < 0 ? 1 : -1);
  };
  const router = useRouter();
  const { experts } = useExpertsContext();
  const editor = entry ? editorOf(experts, agentId, entry.path) : null;
  const where = entry ? folderLabel(entry.path) : "";
  const [opening, setOpening] = useState(false);
  const google = entry ? shortcutKind(entry.name) : null;
  const ext = google ? GOOGLE_LABEL[google] : entry?.name.includes(".") ? entry.name.split(".").pop()!.toUpperCase() : "";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* A panel on the right over the dimmed page (Myriel, Leslie 30/10), the whole height; full
          screen on a phone. Télécharger first, then the one way to change a deliverable. */}
      <DialogContent className="left-auto right-0 top-0 flex h-dvh w-full max-w-[640px] translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 p-0 sm:rounded-l-[22px]">
        {entry && (
          <>
            <DialogHeader className="flex-row items-center gap-3 space-y-0 border-b border-line px-5 py-4 pr-14 text-left">
              {google ? (
                <GoogleTile kind={google} />
              ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-tint text-[11px] font-bold text-brand-ink">{ext.slice(0, 4) || "—"}</span>
              )}
              <span className="min-w-0">
                <DialogTitle className="truncate text-base">{fileLabel(entry)}</DialogTitle>
                <DialogDescription className="truncate text-xs text-ink-3">
                  {[where, ext, google ? null : formatBytes(entry.size)].filter(Boolean).join(" · ")}
                </DialogDescription>
              </span>
            </DialogHeader>
            {pills.length > 0 && (
              <div role="tablist" aria-label="Livrables de cette discussion" className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-line px-5 py-2.5 [mask-image:linear-gradient(to_right,transparent,black_18px,black_calc(100%-18px),transparent)] [scrollbar-width:none]">
                {pills.map((d) => {
                  const on = normDrivePath(d.path) === current;
                  const ext = d.name.includes(".") ? d.name.split(".").pop()!.slice(0, 4).toUpperCase() : "FICH";
                  return (
                    <button
                      key={d.path}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      data-preview-pill={on ? "on" : undefined}
                      title={d.name}
                      onClick={() => asked && setPick({ from: asked.path, entry: { name: d.name, path: d.path, type: "file", size: d.size, modified: d.modified ?? 0, hidden: false } })}
                      className={cn(
                        "inline-flex h-11 max-w-[14rem] shrink-0 items-center gap-2 rounded-full border pl-1.5 pr-3.5 text-[13px] font-medium transition-colors",
                        on ? "border-brand bg-tint text-brand-ink" : "border-line bg-surface text-ink hover:bg-soft",
                      )}
                    >
                      <span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-[9px] font-bold text-white", DOC_TONE[d.kind])}>{ext}</span>
                      <span className="truncate">{d.name.replace(/\.[^.]+$/, "")}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto p-5" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
              <PreviewBody key={entry.path} agentId={agentId} entry={entry} />
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-4">
              {/* A Google shortcut has nothing to download: its document opens in Google. */}
              {!shortcutKind(entry.name) && (
                <Button asChild>
                  <a href={contentUrl(agentId, entry.path, "attachment")} download={fileLabel(entry)}>
                    <Download className="h-4 w-4" />
                    Télécharger
                  </a>
                </Button>
              )}
              {editor && (
                <Button
                  variant="outline"
                  disabled={opening}
                  onClick={async () => {
                    setOpening(true);
                    const session = await originOf(agentId, entry, editor.profileId);
                    setOpening(false);
                    onClose();
                    const thread = session ? `session=${encodeURIComponent(session)}&` : "";
                    router.push(`${agentTabPath(agentId, "chat", editor.profileId)}?${thread}ref=${encodeURIComponent(entry.path)}`);
                  }}
                >
                  {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                  {/* On a phone both buttons hold on one line: « Modifier » alone, the Expert is in the title. */}
                  <span className="sm:hidden">Modifier</span>
                  <span className="max-sm:hidden">{editor.name ? `Modifier avec ${editor.name}` : "Modifier dans le chat d’entreprise"}</span>
                </Button>
              )}
              {isCharteDoc(entry) && (
                <div className="basis-full">
                  <CharteAdopt agentId={agentId} doc={entry} />
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// The conversation that wrote the file, to change it where it was made; null (a new one) when not found
// within a few seconds.
async function originOf(agentId: string, entry: FileEntry, profileId: string | null): Promise<string | null> {
  const q = new URLSearchParams({ path: entry.path, modified: String(entry.modified || "") });
  if (profileId) q.set("profile", profileId);
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/files/origin?${q}`, { signal: AbortSignal.timeout(8000) });
    return res.ok ? (((await res.json()) as { session_id?: string | null }).session_id ?? null) : null;
  } catch {
    return null;
  }
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

// Who changes a deliverable: the Expert whose folder it lies in, or the chat d'entreprise for its own
// folder. Nobody for what the member brought or a file outside any Expert's folder.
function editorOf(experts: Expert[], agentId: string, path: string): { profileId: string | null; name: string | null } | null {
  const parts = path.replace(/^.*?\/Livrables\//, "").split("/");
  if (parts.length < 2) return null;
  if (seatFolderOf(parts)) return { profileId: null, name: null };
  const f = fold(parts[0]);
  const e = experts.find((x) => x.agentId === agentId && [x.driveFolder, x.displayName, x.catalogueKey].some((n) => n && fold(n) === f));
  return e ? { profileId: e.profileId, name: e.displayName } : null;
}

// « Plan de lancement Q4 » for ~/Livrables/Djénéba/Plan de lancement Q4/plan.pdf.
function folderLabel(path: string): string {
  const parts = path.replace(/^.*?\/Livrables\//, "").split("/");
  return parts.length > 1 ? parts[parts.length - 2] : "Livrables";
}

function PreviewBody({ agentId, entry }: { agentId: string; entry: FileEntry }) {
  const kind = previewKind(entry.name);
  const inline = contentUrl(agentId, entry.path, "inline");
  const frame = "h-[calc(100dvh-13rem)] min-h-[50vh] w-full rounded-md border bg-background";

  if (kind === "image") {
    return (
      <a href={inline} target="_blank" rel="noopener" title="Ouvrir en taille réelle" className="flex max-h-[70vh] justify-center overflow-auto rounded-md border bg-secondary/30 p-4">
        <ReducedImage thumb={thumbUrl(agentId, entry.path, 1600, entry.modified)} original={inline} alt={entry.name} className="max-h-[66vh] max-w-full object-contain" />
      </a>
    );
  }

  if (kind === "video") {
    return (
      <div className="flex max-h-[70vh] min-h-[40vh] items-center justify-center overflow-hidden rounded-md border bg-black/95 p-2">
        <video
          src={inline}
          controls
          playsInline
          className="max-h-[66vh] max-w-full rounded object-contain shadow-sm"
        >
          Votre navigateur ne prend pas en charge la lecture directe de vidéos.
        </video>
      </div>
    );
  }

  if (kind === "audio") {
    return (
      <div className="flex min-h-[12rem] flex-col items-center justify-center gap-4 rounded-md border bg-secondary/30 p-6">
        <p className="text-sm font-medium text-foreground">{entry.name}</p>
        <audio src={inline} controls className="w-full max-w-md">
          Votre navigateur ne prend pas en charge la lecture directe de fichiers audio.
        </audio>
      </div>
    );
  }

  if (kind === "pdf") {
    return <iframe src={inline} title={entry.name} className={frame} />;
  }

  // html / svg: never render as an active document on our origin — strip every iframe permission.
  if (kind === "sandbox") {
    return <iframe src={inline} title={entry.name} sandbox="" className={frame} />;
  }

  if (shortcutKind(entry.name)) {
    return <GoogleShortcut url={inline} name={entry.name} />;
  }

  if (kind === "text") {
    return <TextPreview url={inline} markdown={/\.(md|markdown)$/i.test(entry.name)} />;
  }

  // Word, Excel and PowerPoint: read here in full, as far as it goes (Leslie, 26/10: the preview opens
  // from Livrables on the web as on the app).
  const doc = docKind(entry.name);
  if (doc === "word" || doc === "excel" || doc === "powerpoint") {
    return (
      <div className="h-[65vh] overflow-hidden rounded-md border bg-white">
        <DocPreview full agentId={agentId} doc={{ name: entry.name, path: entry.path, size: entry.size ?? null, modified: entry.modified ?? null, kind: doc }} />
      </div>
    );
  }

  return (
    <div className="flex min-h-[12rem] flex-col items-center justify-center gap-2 rounded-md border bg-secondary/30 text-sm text-muted-foreground">
      <p>Pas d’aperçu pour ce type de fichier.</p>
      <p>Téléchargez-le pour l’ouvrir.</p>
    </div>
  );
}

/** The reduced copy first; the original if the copy cannot be made. */
export function ReducedImage({ thumb, original, alt, className, onFail }: { thumb: string; original: string; alt: string; className?: string; onFail?: () => void }) {
  const [src, setSrc] = useState(thumb);
  useEffect(() => setSrc(thumb), [thumb]);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- streamed via our BFF, not a remote asset
    <img src={src} alt={alt} loading="lazy" decoding="async" className={className} onError={() => (src === thumb ? setSrc(original) : onFail?.())} />
  );
}

// A Google document the Expert keeps a shortcut of in its drive (Leslie, 31/10): it lives in Google,
// so the preview is its name and the way there.
function GoogleShortcut({ url, name }: { url: string; name: string }) {
  const [doc, setDoc] = useState<GoogleDoc | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setDoc(undefined);
    fetch(url)
      .then((res) => (res.ok ? res.text() : Promise.reject()))
      .then((body) => !cancelled && setDoc(parseShortcut(name, body)))
      .catch(() => !cancelled && setDoc(null));
    return () => {
      cancelled = true;
    };
  }, [url, name]);
  if (doc === undefined)
    return (
      <div className="flex min-h-[12rem] items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  if (!doc) return <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">Ce raccourci ne mène à aucun document Google.</p>;
  return (
    <div className="flex min-h-[12rem] flex-col items-center justify-center gap-4 rounded-md border bg-secondary/30 p-6 text-center">
      <GoogleTile kind={doc.kind} className="size-14 rounded-2xl [&_svg]:h-9 [&_svg]:w-7" />
      <p className="text-[15px] font-semibold text-ink">{doc.title}</p>
      <Button asChild className="h-11 rounded-xl px-5">
        <a href={doc.url} target="_blank" rel="noopener noreferrer">
          <ExternalLink /> Ouvrir dans {GOOGLE_LABEL[doc.kind]}
        </a>
      </Button>
    </div>
  );
}

// A note written in markdown (.md) reads as a document, titles and lists rendered, not as raw text
// (PDF du 30/10 : « un .md n'ouvrait rien »).
function TextPreview({ url, markdown = false }: { url: string; markdown?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error("Ce fichier n’a pas pu être chargé.");
        // Cap the rendered slice so a huge log can't lock the tab.
        const body = await res.text();
        return body.length > 500_000 ? `${body.slice(0, 500_000)}\n\n… (aperçu tronqué)` : body;
      })
      .then((body) => !cancelled && setText(body))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) return <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>;
  if (text == null)
    return (
      <div className="flex min-h-[12rem] items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  if (markdown)
    return (
      <div className="max-h-[70vh] overflow-auto rounded-md border bg-surface px-6 py-5 text-[15px] leading-relaxed text-ink">
        <Markdown content={text} />
      </div>
    );
  return (
    <pre className="max-h-[70vh] overflow-auto rounded-md border bg-secondary/30 p-4 text-xs leading-relaxed text-foreground">
      {text}
    </pre>
  );
}
