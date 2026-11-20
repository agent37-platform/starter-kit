"use client";

import { useRef } from "react";
import { FileText, Loader2, Paperclip, RotateCw, X } from "lucide-react";
import { HiddenFileInput } from "@/components/HiddenFileInput";
import { TOO_LARGE, tooLargeDocument } from "@/lib/upload-limit";
import { cn } from "@/lib/utils";
import type { PendingFile } from "./useChatAttachments";

export function AttachButton({ onFiles, disabled }: { onFiles: (files: FileList) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => ref.current?.click()}
        aria-label="Joindre des fichiers"
        title="Joindre des fichiers"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50 max-sm:h-10 max-sm:w-10"
      >
        <Paperclip className="h-4 w-4" />
      </button>
      <HiddenFileInput inputRef={ref} onFiles={onFiles} />
    </>
  );
}

export function AttachmentTray({
  files,
  onRemove,
  onRetry,
}: {
  files: PendingFile[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-2 px-4 pb-2">
      {files.map((f) => (
        <div
          key={f.id}
          title={f.status === "error" ? f.error : undefined}
          className={cn(
            "flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs",
            f.status === "error" ? "border-ko/40 bg-ko-pale text-ko" : "border-line bg-soft text-ink"
          )}
        >
          {f.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- object URL thumbnail, not a remote asset
            <img src={f.previewUrl} alt="" className="h-6 w-6 rounded object-cover" />
          ) : (
            <FileText className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="max-w-[10rem] truncate">{f.file.name}</span>
          {f.status === "uploading" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {f.status === "uploading" && f.progress !== undefined && <span className="tabular-nums text-ink-3">{Math.round(f.progress * 100)} %</span>}
          {f.status === "error" && tooLargeDocument(f.file) && <span className="font-semibold">plus de 25 Mo</span>}
          {f.status === "error" && !tooLargeDocument(f.file) && f.error === TOO_LARGE && <span className="font-semibold">plus de 4 Mo</span>}
          {f.status === "error" && !tooLargeDocument(f.file) && f.error !== TOO_LARGE && (
            <button
              type="button"
              onClick={() => onRetry(f.id)}
              aria-label="Réessayer l’envoi"
              title="Réessayer l’envoi"
              className="text-destructive hover:text-destructive/80"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onRemove(f.id)}
            aria-label="Retirer la pièce jointe"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
