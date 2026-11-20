"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, FileText, Image as ImageIcon, PhoneCall, Presentation, Sheet } from "lucide-react";
import { FilePreview } from "@/components/files/FilePreview";
import type { FileEntry } from "@/components/files/types";
import { formatBytes } from "@/components/files/types";
import { apiFetch } from "@/lib/api";
import { callFiles, pickCall } from "@/lib/call-conversation";
import { turnDocs } from "@/lib/drive-links";
import { agentTabPath } from "@/lib/expert-tabs";
import { callDuration, frenchSpacing, summarySections, type CallRecord } from "@/lib/voice";
import { callStartOf } from "@/lib/voice-sessions";
import { useChatContext } from "./ChatProvider";
import { useDriveListing } from "./DocumentCards";
import type { TurnDoc } from "@/lib/drive-links";

/**
 * The head of a call's conversation, in place of the transcript handed to the expert (Leslie, 20/11,
 * option A): the call, its summary, the files delivered during it, and the way to its full page.
 * Without the back office's record (not written yet, no voice), the call's date alone.
 */
export function CallCard({ content, at, driveFolder }: { content: string; at: number | null; driveFolder: string | null }) {
  const { agentId, profile, activeSessionId } = useChatContext();
  const expertKey = profile ? (profile.split("__").pop() ?? null) : null;
  const written = callStartOf(content);
  const [call, setCall] = useState<CallRecord | null>(null);
  useEffect(() => {
    if (!expertKey) return;
    let live = true;
    apiFetch<{ items: CallRecord[] }>(`/api/voice/calls?expert=${encodeURIComponent(expertKey)}`)
      .then((r) => live && setCall(pickCall(r.items ?? [], activeSessionId, written ?? at)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [expertKey, activeSessionId, written, at]);

  const start = call ? Date.parse(call.startedAt) : (written ?? at);
  const end = call?.endedAt ? Date.parse(call.endedAt) : null;
  const listing = useDriveListing(agentId, driveFolder, start == null ? null : Math.floor((start - 60_000) / 60_000) * 60_000, activeSessionId ?? "");
  const docs = useMemo(() => (start == null ? [] : turnDocs("", listing, callFiles(listing, start, end))), [listing, start, end]);

  const when = start == null ? "" : new Date(start).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const length = call?.durationSeconds != null ? callDuration(call.durationSeconds) : "";
  const sections = call ? summarySections(call) : null;
  const lines = sections ? sections.flatMap((s) => s.items) : (call?.summary ?? []);

  return (
    <section aria-label="Appel" className="mx-auto w-full max-w-[min(100%,70ch)] rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <p className="flex items-center gap-2 text-[13px] text-ink-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-soft text-ink-2">
          <PhoneCall className="size-3.5" />
        </span>
        <span>
          Appel{length ? ` de ${length}` : ""}
          {when ? `, le ${when}` : ""}
        </span>
      </p>
      {call?.subject && <h3 className="mt-3 text-[16px] font-semibold text-ink">{frenchSpacing(call.subject)}</h3>}
      {lines.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-ink marker:text-ink-3">
          {lines.slice(0, 6).map((line, k) => (
            <li key={k}>{frenchSpacing(line)}</li>
          ))}
        </ul>
      ) : (
        call?.subjectPending && <p className="mt-2 text-sm text-ink-3">Le résumé arrive…</p>
      )}
      {docs.length > 0 && <CallFiles agentId={agentId} docs={docs} />}
      {call && profile && (
        <Link
          href={`${agentTabPath(agentId, "calls", profile)}?appel=${encodeURIComponent(call.id)}`}
          className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand hover:underline"
        >
          Compte rendu et transcription <ChevronRight className="size-4" />
        </Link>
      )}
    </section>
  );
}

// The call's files in short rows, not in large previews: the card stays a summary (one row opens the file).
function CallFiles({ agentId, docs }: { agentId: string; docs: TurnDoc[] }) {
  const [open, setOpen] = useState<FileEntry | null>(null);
  const Icon = (d: TurnDoc) => (d.kind === "image" ? ImageIcon : d.kind === "powerpoint" ? Presentation : d.kind === "excel" ? Sheet : FileText);
  return (
    <>
      <ul aria-label="Livrables de l’appel" className="mt-3 flex flex-col gap-1.5">
        {docs.slice(0, 5).map((d) => {
          const I = Icon(d);
          return (
            <li key={d.path}>
              <button
                type="button"
                onClick={() => setOpen({ name: d.name, path: d.path, type: "file", size: d.size, modified: d.modified ?? 0, hidden: false })}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-line bg-background px-3 py-2 text-left transition-colors hover:bg-soft"
              >
                <I className="size-4 shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{d.name}</span>
                {d.size != null && <span className="shrink-0 text-xs text-ink-3">{formatBytes(d.size)}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <FilePreview agentId={agentId} entry={open} onClose={() => setOpen(null)} />
    </>
  );
}
