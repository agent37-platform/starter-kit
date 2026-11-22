"use client";

import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from "react";
import { toast } from "sonner";
import { readApiError } from "@/lib/api";
import { needsParts, PART_BYTES, TOO_LARGE, TOO_LARGE_DOCUMENT, tooLargeDocument } from "@/lib/upload-limit";
import { PartsError, sendInParts } from "@/lib/upload-parts";
import { uid, type MessageAttachment } from "./types";
import { useDropZone } from "../useDropZone";

export interface PendingFile {
  id: string;
  file: File;
  previewUrl: string | null; // object URL for images, for the tray thumbnail
  status: "uploading" | "uploaded" | "error";
  path?: string; // instance path returned by the upload, passed to the turn's `files`
  error?: string;
  /** 0 to 1 while a file over 4 MB goes in parts. */
  progress?: number;
}

// Drag-drop / paste / click attachments. Each file uploads immediately to the instance
// (POST /api/agents/{id}/chat/files) and the returned path is collected at send time.
export function useChatAttachments(agentId: string, onFocusRequest?: () => void) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const controllers = useRef<Map<string, AbortController>>(new Map());
  const filesRef = useRef<PendingFile[]>([]);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const patch = (id: string, p: Partial<PendingFile>) =>
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...p } : f)));

  const startUpload = useCallback(
    async (pf: PendingFile) => {
      const ctrl = new AbortController();
      controllers.current.set(pf.id, ctrl);
      let aborted = false;
      try {
        // Over the host's limit: in parts of 3 MB (lib/upload-parts.ts), the share sent shown on the chip.
        if (needsParts(pf.file)) {
          patch(pf.id, { progress: 0 });
          try {
            const data = await sendInParts<{ path?: string }>(pf.file, { kind: "chat", agentId }, {
              partBytes: PART_BYTES,
              signal: ctrl.signal,
              onProgress: (progress) => patch(pf.id, { progress }),
            });
            patch(pf.id, { status: "uploaded", path: data.path, progress: undefined });
          } catch (e) {
            // A back office that does not take parts yet: the limit stays 4 MB.
            if (e instanceof PartsError && e.status === 404) throw new Error(TOO_LARGE);
            throw e;
          }
          return;
        }
        const form = new FormData();
        form.append("file", pf.file, pf.file.name);
        const res = await fetch(`/api/agents/${agentId}/chat/files`, {
          method: "POST",
          body: form,
          signal: ctrl.signal,
        });
        if (!res.ok) {
          throw new Error(await readApiError(res, "L’envoi a échoué"));
        }
        const data = (await res.json()) as { path?: string };
        patch(pf.id, { status: "uploaded", path: data.path });
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          aborted = true;
          return;
        }
        patch(pf.id, { status: "error", error: (e as Error).message, progress: undefined });
      } finally {
        controllers.current.delete(pf.id);
        if (!aborted) onFocusRequest?.();
      }
    },
    [agentId, onFocusRequest]
  );

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const pfs: PendingFile[] = Array.from(incoming).map((file) => ({
        id: uid("f"),
        file,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
        // A file over the limit is shown refused, with the reason, and never sent.
        ...(tooLargeDocument(file) ? { status: "error" as const, error: TOO_LARGE_DOCUMENT } : { status: "uploading" as const }),
      }));
      if (!pfs.length) return;
      for (const pf of pfs.filter((x) => x.status === "error").slice(0, 3)) toast.error(`${pf.file.name} : ${TOO_LARGE_DOCUMENT}`);
      setFiles((prev) => [...prev, ...pfs]);
      onFocusRequest?.();
      pfs.filter((pf) => pf.status === "uploading").forEach(startUpload);
    },
    [onFocusRequest, startUpload]
  );

  // A deliverable already in the drive, given to the expert as the file to work on (« Modifier avec
  // <Expert> », Myriel, Leslie 30/10): nothing to upload, its drive path rides in the turn's `files`.
  const addReference = useCallback(
    (path: string) => {
      const name = path.split("/").pop() || path;
      setFiles((prev) => (prev.some((f) => f.path === path) ? prev : [...prev, { id: uid("f"), file: new File([], name), previewUrl: null, status: "uploaded", path }]));
      onFocusRequest?.();
    },
    [onFocusRequest]
  );

  const removeFile = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    setFiles((prev) => {
      const f = prev.find((x) => x.id === id);
      if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  const retryFile = useCallback(
    (id: string) => {
      const f = filesRef.current.find((x) => x.id === id);
      // Sending a file over the limit again would fail the same way.
      if (!f || tooLargeDocument(f.file)) return;
      patch(id, { status: "uploading", error: undefined });
      startUpload({ ...f, status: "uploading", error: undefined });
    },
    [startUpload]
  );

  const clearFiles = useCallback(() => {
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    setFiles((prev) => {
      prev.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
      return [];
    });
  }, []);

  // Collect uploaded attachments (path + display name) for the outgoing turn, then clear the
  // tray. The path rides in the turn's `files`; name/isImage drive the chip in the sent bubble.
  const takeAttachments = useCallback((): MessageAttachment[] => {
    const atts = filesRef.current
      .filter((f): f is PendingFile & { path: string } => !!f.path)
      .map((f) => ({ name: f.file.name, path: f.path, isImage: f.file.type.startsWith("image/") }));
    clearFiles();
    return atts;
  }, [clearFiles]);

  // Whole-pane drag-drop; spread onto the drop zone in ChatView.
  const { dragOver, dragHandlers } = useDropZone(addFiles);

  const handlePaste = (e: ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []).filter((i) => i.kind === "file");
    if (!items.length) return;
    const picked = items.map((i) => i.getAsFile()).filter((f): f is File => !!f);
    if (picked.length) {
      e.preventDefault();
      addFiles(picked);
    }
  };

  useEffect(() => () => clearFiles(), [clearFiles]);

  const uploading = files.some((f) => f.status === "uploading");
  const hasError = files.some((f) => f.status === "error");

  return {
    files,
    addReference,
    dragOver,
    addFiles,
    removeFile,
    retryFile,
    takeAttachments,
    clearFiles, // ChatView calls this on thread switch so a staged file can't leak into another chat
    dragHandlers,
    handlePaste,
    uploading,
    hasFiles: files.length > 0,
    // Send is blocked while uploads are in flight or failed (so paths are ready at send time).
    blocksSend: uploading || hasError,
  };
}

// The shared attachment state, lifted to ChatView so the whole pane is a drop zone and passed
// down to the composer (tray, attach button, paste). One instance for the whole chat pane —
// ChatView resets it (clearFiles) on every thread switch so a staged file stays with its chat.
export type ChatAttachments = ReturnType<typeof useChatAttachments>;
