"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Folder, Lock, Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useExpertsContext } from "@/components/experts/ExpertsProvider";
import { ExpertAvatar } from "@/components/experts/ExpertAvatar";
import { FilePreview } from "@/components/files/FilePreview";
import { formatMtime, type FileEntry } from "@/components/files/types";
import { useAllDeliverables } from "@/components/files/useAllDeliverables";
import type { Expert } from "@/lib/types";

const NO_EXPERTS: Expert[] = [];
import { fold, useAllConversations, useDriveFiles, useOwnAgentId } from "./useAllConversations";
import { fileLabel } from "@/lib/drive-paths";
import { setSearchOpen as setOpen, useSearchOpen, useSearchWarm } from "./SearchDialog";

const SHOWN = 8;

// « Rechercher » (Ctrl K): the member's conversations (chat d'entreprise and every Expert) by title,
// and the drive's files by name. A conversation opens in its space, a file in its preview. With
// nothing typed, the latest of each.
export function SearchPanel() {
  const open = useSearchOpen();
  const ownAgentId = useOwnAgentId();
  const warm = useSearchWarm();
  const { experts } = useExpertsContext();
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState<FileEntry | null>(null);
  const convs = useAllConversations(ownAgentId, experts, open || warm);
  const files = useDriveFiles(ownAgentId, open || warm);
  // The deliverables' folders too (« Plan de lancement Q4 »), not only the files at the top of the drive.
  const folders = useAllDeliverables(open || warm ? ownAgentId : null, open || warm ? experts : NO_EXPERTS);

  const needle = fold(q.trim());
  const foundConvs = useMemo(
    () => (convs ?? []).filter((c) => !needle || fold(c.session.routine ?? c.session.title ?? "").includes(needle)).slice(0, needle ? SHOWN * 3 : SHOWN),
    [convs, needle]
  );
  // Typed something: the conversations by where they live, the chat d'entreprise first then each
  // Expert (Myriel, Leslie 30/10). Nothing typed: the latest, as one list.
  const convGroups = useMemo(() => {
    if (!needle) return foundConvs.length === 0 ? [] : [{ key: "_", expert: null as (typeof foundConvs)[number]["expert"], label: "Conversations", rows: foundConvs }];
    const out: { key: string; expert: (typeof foundConvs)[number]["expert"]; label: string; rows: typeof foundConvs }[] = [];
    for (const c of foundConvs) {
      const key = c.expert ? `${c.expert.agentId}:${c.expert.profileId}` : "entreprise";
      const g = out.find((x) => x.key === key);
      if (g) {
        if (g.rows.length < 4) g.rows.push(c);
      } else out.push({ key, expert: c.expert, label: c.expert?.displayName ?? "Chat d’entreprise", rows: [c] });
    }
    return out.sort((a, b) => Number(!!a.expert) - Number(!!b.expert));
  }, [foundConvs, needle]);
  const foundFiles = useMemo(() => (files ?? []).filter((f) => !needle || fold(fileLabel(f)).includes(needle)).slice(0, SHOWN), [files, needle]);
  const foundFolders = useMemo(
    () => (needle ? (folders ?? []).filter((d) => d.folder && fold(d.name).includes(needle)).slice(0, SHOWN) : []),
    [folders, needle]
  );
  const loading = convs === null || files === null;

  const close = () => {
    setOpen(false);
    setQ("");
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
        <DialogContent className="top-[12vh] max-w-xl translate-y-0 gap-0 p-0" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Rechercher</DialogTitle>
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <Search className="size-5 shrink-0 text-ink-3" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher une conversation, un livrable…"
              className="h-14 w-full bg-transparent text-[15px] text-ink placeholder:text-ink-3 focus:outline-none"
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {loading && foundConvs.length === 0 && foundFiles.length === 0 && foundFolders.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-ink-3">Recherche…</p>
            ) : foundConvs.length === 0 && foundFiles.length === 0 && foundFolders.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-ink-3">Aucun résultat pour « {q.trim()} ».</p>
            ) : (
              <>
                {convGroups.map((g) => (
                  <div key={g.key}>
                    <p className="flex items-center gap-2 px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-3">
                      {g.label}
                      {needle && <span className="font-medium normal-case">{g.rows.length}</span>}
                    </p>
                {g.rows.map((c) => (
                  // A link, not a button: the page is read ahead under the pointer, and the bar at the top
                  // of the window starts with the click (Leslie, 27/10: the conversation was slow to show).
                  <Link
                    key={c.href}
                    href={c.href}
                    onClick={close}
                    className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-1.5 text-left hover:bg-soft"
                  >
                    {c.expert ? (
                      <ExpertAvatar expert={{ ...c.expert, gateway: null }} size="xs" />
                    ) : (
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-tint text-brand-ink">
                        <Lock className="size-3.5" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        <Highlight text={c.session.routine ?? (c.session.title || "Nouvelle conversation")} needle={needle} />
                      </span>
                      <span className="block truncate text-xs text-ink-3">{c.expert ? c.expert.displayName : "Chat d’entreprise"}</span>
                    </span>
                  </Link>
                ))}
                  </div>
                ))}
                {foundFiles.length + foundFolders.length > 0 && <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-3">Livrables</p>}
                {foundFolders.map((d) => (
                  <Link key={`${d.agentId}:${d.path}`} href={d.href} onClick={close} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-1.5 text-left hover:bg-soft">
                    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-tint text-brand-ink">
                      <Folder className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        <Highlight text={d.name} needle={needle} />
                      </span>
                      <span className="block truncate text-xs text-ink-3">
                        {d.expert?.displayName ?? "Chat d’entreprise"} · {d.files === 1 ? "1 fichier" : `${d.files} fichiers`}
                      </span>
                    </span>
                  </Link>
                ))}
                {foundFiles.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => {
                      close();
                      setPreview(f);
                    }}
                    className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-1.5 text-left hover:bg-soft"
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-tint text-brand-ink">
                      <FileText className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        <Highlight text={fileLabel(f)} needle={needle} />
                      </span>
                      <span className="block truncate text-xs text-ink-3">{formatMtime(f.modified)}</span>
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {ownAgentId && <FilePreview agentId={ownAgentId} entry={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

// The words typed, marked where they are found: accents and case aside, the original text shown.
function Highlight({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>;
  // fold() keeps one character per character of a precomposed text: positions carry over.
  const at = fold(text).indexOf(needle);
  if (at < 0 || fold(text).length !== text.length) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[3px] bg-amber-200/70 px-px text-inherit dark:bg-amber-400/30">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}
