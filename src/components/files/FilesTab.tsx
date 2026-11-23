"use client";

import { useSearchParams } from "next/navigation";
import { DRIVE_ROOT } from "@/lib/drive-paths";
import { FilesView } from "./FilesView";

// The native Files tab. The shell mounts this against the active agent (agentId, from the URL) and
// keeps it MOUNTED-BUT-HIDDEN across tab switches, so FilesView's current directory (held in
// useFileBrowser state) survives moving between tabs. `initialPath` is where it opens (an expert's own folder in the drive). Writes are gated server-side: the BFF routes
// enforce admin on every mutation, so there is nothing to gate in the UI yet.
// « ?dossier=<path> » opens that folder: a folder the Expert cites in the chat links here.
export function FilesTab({ agentId, initialPath, onAsk }: { agentId: string; initialPath?: string; onAsk?: () => void }) {
  const params = useSearchParams();
  const openPath = params.get("dossier");
  // « &fichier=<path> » opens that file's preview over its folder (a deliverable cited outside the app).
  const openFile = params.get("fichier");
  // What the member imports goes to « Reçus » in the Expert's folder, apart from what the Expert made.
  const inbox = `${initialPath ?? DRIVE_ROOT}/Reçus`;
  return <FilesView agentId={agentId} initialPath={openPath ?? initialPath} openPath={openPath} openFile={openFile} inbox={inbox} home={initialPath} onAsk={onAsk} />;
}
