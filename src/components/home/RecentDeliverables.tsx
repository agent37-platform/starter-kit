"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { FileText, FolderOpen } from "lucide-react";
import { useDriveFiles } from "@/components/conversations/useAllConversations";
import { formatMtime, type FileEntry } from "@/components/files/types";
import { fileLabel, isMemberUpload } from "@/lib/drive-paths";

// Loaded on a click only: the preview carries the markdown renderer.
const FilePreview = dynamic(() => import("@/components/files/FilePreview").then((m) => m.FilePreview), { ssr: false });

const SHOWN = 6;

// « Derniers livrables » on the home page: the latest files of the drive. A click opens the file's
// preview. While nothing is read, or when the drive is empty, the block says so in a line. What the
// member brought (attachments, « Reçus ») is not a deliverable (Leslie, 30/10).
export function RecentDeliverables({ agentId }: { agentId: string }) {
  const all = useDriveFiles(agentId);
  const files = all ? all.filter((f) => !isMemberUpload(f.path)).slice(0, SHOWN) : null;
  const [preview, setPreview] = useState<FileEntry | null>(null);

  return (
    <section className="mt-10">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Derniers livrables</h2>
      {files === null ? (
        <p className="mt-3 text-sm text-ink-3">Chargement…</p>
      ) : files.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-3">
          <FolderOpen className="size-4" /> Les livrables de vos Experts apparaîtront ici.
        </p>
      ) : (
        <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => setPreview(f)}
              className="flex min-h-16 items-center gap-3 rounded-card border border-line bg-surface p-3 text-left transition-colors hover:bg-soft"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-tint text-brand-ink">
                <FileText className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-ink">{fileLabel(f)}</span>
                <span className="block truncate text-xs text-ink-3">{formatMtime(f.modified)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {preview && <FilePreview agentId={agentId} entry={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}
