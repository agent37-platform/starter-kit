"use client";

import { memo, useMemo, useState, type MouseEvent } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { ANGLED, BARE, citedFolder, CODE, FOLDER_BARE, FOLDER_CODE, isHiddenInChat, LINKED, normDrivePath, noteFolder, openTarget, safeDecode } from "@/lib/drive-links";
import { paragraphCache } from "@/lib/paragraph-cache";
import { replyLines } from "@/lib/reply-lines";
import { agentTabPath } from "@/lib/expert-tabs";
import type { FileEntry } from "@/components/files/types";

// Loaded on a click only, and apart: FilePreview itself renders markdown with this component.
const FilePreview = dynamic(() => import("@/components/files/FilePreview").then((m) => m.FilePreview), { ssr: false });

const OPEN_LINK = /\[([^\]\n]*)\]\(<?((?:https?:\/\/[^\s)>]+)?\/livrables\/ouvrir\?p=[^\s)>]+)>?\)/g;
const OPEN_BARE = /(^|[\s(«])((?:https?:\/\/[^\s)<>]+)\/livrables\/ouvrir\?p=[^\s)<>»]+)/g;
const HIDDEN_LINK = /\[([^\]\n]*)\]\(<?(?:file:\/\/|sandbox:)?((?:\/home\/node|~)\/Livrables\/[^)>\n]+)>?\)/g;

// Experts give the drive path of what they saved (see lib/drive-paths.ts for the drive itself); turn those paths into download links (the
// browser can't open file:// links or instance paths, and Streamdown blocks them). A working note or memory file keeps its name, unlinked.
// A folder the Expert cites opens in Livrables, at that folder (Leslie, 27/10: « tu peux pas les rendre
// par défaut cliquables, sinon ça sert à rien »).
// `files` collects each link's text and the drive path behind it: a click on one opens its preview.
function linkDriveFiles(content: string, agentId: string, profileId?: string | null, files?: Map<string, string>): string {
  const url = (path: string) =>
    `/api/agents/${agentId}/files/content?path=${encodeURIComponent(normDrivePath(path))}&disposition=attachment`;
  // A link's text is markdown: an underscore or a star in a file name must not turn into emphasis.
  const md = (label: string) => label.replace(/([_*\[\]])/g, "\\$1");
  const name = (path: string) => md(safeDecode(path.split("/").pop() ?? path));
  const link = (label: string, path: string) => {
    const note = noteFolder(path);
    // A note opens in its preview now (PDF du 30/10 : « un .md n'ouvrait rien »), its folder as before
    // when the preview cannot be shown.
    if (note) files?.set(normDrivePath(path).replace(/^~\//, ""), normDrivePath(path));
    if (note) return `[${md(normDrivePath(path).replace(/^~\//, ""))}](${agentTabPath(agentId, "files", profileId)}?dossier=${encodeURIComponent(note)})`;
    if (isHiddenInChat(path)) return label;
    files?.set(safeDecode(path.split("/").pop() ?? path), normDrivePath(path));
    return `[${label}](${url(path)})`;
  };
  // The Experts also write a deliverable as a full address (« https://<client>.app.yelema.ai/livrables/ouvrir?p=… »,
  // made for Telegram). In the chat it opens beside the conversation like any other file, never on the Livrables
  // page (Leslie, 02/11 : « je dois repartir en arrière pour repartir dans la conversation »); a folder opens in
  // Livrables, as a cited folder does.
  const opened = (label: string | null, href: string) => {
    const t = openTarget(href);
    if (!t) return null;
    if (!t.file) return folderLink(t.path, agentId, profileId);
    const text = label?.trim() || name(t.path);
    files?.set(text.replace(/\\([_*\[\]])/g, "$1").replace(/[*_]/g, "").trim(), t.path);
    return `[${text}](${url(t.path)})`;
  };
  return content
    .replace(OPEN_LINK, (m, label: string, href: string) => opened(label, href) ?? m)
    .replace(OPEN_BARE, (m, lead: string, href: string) => {
      const l = opened(null, href);
      return l ? `${lead}${l}` : m;
    })
    .replace(HIDDEN_LINK, (m, label: string, path: string) => {
      if (isHiddenInChat(path)) return label;
      files?.set(label.replace(/[*_]/g, "").trim(), normDrivePath(path));
      return m;
    })
    .replace(ANGLED, (_m, path: string) => `](${url(path)})`)
    .replace(LINKED, (_m, path: string) => `](${url(path)})`)
    .replace(CODE, (_m, path: string) => link(name(path), path))
    .replace(BARE, (_m, lead: string, path: string) => `${lead}${link(name(path), path)}`)
    .replace(FOLDER_CODE, (m, path: string) => folderLink(path, agentId, profileId) ?? m)
    .replace(FOLDER_BARE, (m, lead: string, path: string) => {
      const l = folderLink(path, agentId, profileId);
      return l ? `${lead}${l}` : m;
    });
}

function folderLink(path: string, agentId: string, profileId?: string | null): string | null {
  const folder = citedFolder(path);
  if (!folder) return null;
  const label = folder.replace(/^~\//, "").replace(/([_*\[\]])/g, "\\$1");
  return `[${label}](${agentTabPath(agentId, "files", profileId)}?dossier=${encodeURIComponent(folder)})`;
}

// Our own links (drive downloads) open directly; external ones still ask first.
const LINK_SAFETY = { enabled: true, onLinkCheck: (url: string) => url.startsWith("/") };

const FR = {
  close: "Fermer",
  copied: "Copié",
  copyCode: "Copier le code",
  copyLink: "Copier le lien",
  copyTable: "Copier le tableau",
  copyTableAsCsv: "Copier en CSV",
  copyTableAsMarkdown: "Copier en Markdown",
  copyTableAsTsv: "Copier en TSV",
  downloadDiagram: "Télécharger le schéma",
  downloadFile: "Télécharger le fichier",
  downloadImage: "Télécharger l’image",
  downloadTable: "Télécharger le tableau",
  downloadTableAsCsv: "Télécharger en CSV",
  downloadTableAsMarkdown: "Télécharger en Markdown",
  exitFullscreen: "Quitter le plein écran",
  externalLinkWarning: "Ce lien ouvre un site extérieur à Yelema.",
  imageNotAvailable: "Image indisponible",
  openExternalLink: "Ouvrir le lien externe ?",
  openLink: "Ouvrir le lien",
  viewFullscreen: "Plein écran",
};

// Streaming-aware markdown: Streamdown tolerates incomplete markdown (unclosed fences, partial
// tables) so we can feed it the running output buffer on every delta without flicker.
export const Markdown = memo(function Markdown({ content, agentId, profileId }: { content: string; agentId?: string; profileId?: string | null }) {
  const router = useRouter();
  // Streamdown opens every link in a new tab; a cited folder opens in this one, in Livrables. Its link
  // reads as the folder itself (« Livrables/Fatima/… »), which is how it is told apart from a file.
  const openFolder = (e: MouseEvent<HTMLDivElement>) => {
    const el = (e.target as Element).closest?.("[data-streamdown=link]");
    const label = el?.textContent?.trim() ?? "";
    const folder = agentId && /^Livrables\//.test(label) ? (citedFolder(label) ?? noteFolder(label)) : null;
    if (!folder || !agentId) return;
    e.preventDefault();
    e.stopPropagation();
    router.push(`${agentTabPath(agentId, "files", profileId)}?dossier=${encodeURIComponent(folder)}`);
  };
  // A delivered file opens in its preview, with « Télécharger » there, rather than downloading at once
  // (PDF du 30/10 : « aperçu et téléchargement dans le chat »).
  // A live answer grows by the delta: its finished paragraphs are linked once (no rewrite spans a blank line).
  const linked = useMemo(
    () =>
      paragraphCache(
        (part: string) => {
          const files = new Map<string, string>();
          return { text: agentId ? linkDriveFiles(part, agentId, profileId, files) : part, files };
        },
        (a, b) => ({ text: a.text + b.text, files: b.files.size ? new Map([...a.files, ...b.files]) : a.files })
      ),
    [agentId, profileId]
  );
  const { text, files } = useMemo(() => {
    const out = linked(content);
    return { text: replyLines(out.text), files: out.files };
  }, [content, linked]);
  const [preview, setPreview] = useState<FileEntry | null>(null);
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const el = (e.target as Element).closest?.("[data-streamdown=link]");
    const path = agentId ? files.get(el?.textContent?.trim() ?? "") : undefined;
    if (!path) return openFolder(e);
    e.preventDefault();
    e.stopPropagation();
    const name = path.split("/").pop() ?? path;
    setPreview({ name, path, type: "file", size: null, modified: 0 } as FileEntry);
  };
  return (
    <div onClickCapture={onClick}>
      <Streamdown className="chat-markdown text-[15px] leading-relaxed" linkSafety={LINK_SAFETY} translations={FR}>
        {text}
      </Streamdown>
      {preview && agentId && <FilePreview agentId={agentId} entry={preview} onClose={() => setPreview(null)} />}
    </div>
  );
});
