"use client";

import { Picker } from "@/components/ui/picker";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Globe, Loader2, NotebookPen, Palette, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, readApiError } from "@/lib/api";
import type { MemoryItem, MemoryList } from "@/lib/memory";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { HiddenFileInput } from "@/components/HiddenFileInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MemoryGroups } from "./MemoryGroups";
import { EssentialTile } from "@/components/company/EssentialTile";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import Link from "next/link";
import { useExpertsContext } from "@/components/experts/ExpertsProvider";
import { usePoll } from "@/components/usePoll";
import { runPool } from "@/lib/bulk";
import { MAX_UPLOAD_BYTES, tooLarge } from "@/lib/upload-limit";

// The limit said in every refusal of a too large file (Leslie, 07/11): the host refuses it before the app sees it.
const LIMIT_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
const tooBig = (what: string) => `${what} dépasse ${LIMIT_MB} Mo, la taille maximale d’un envoi. Réduisez-la (un PDF compressé, par exemple) puis réessayez.`;
import { driveTree } from "@/lib/drive-store";
import { expertPath } from "@/lib/expert-tabs";

// The company memory: what the experts know of the company. Everyone sees the deposits of their own
// compartments; whoever may deposit adds a note or a document. The back office sends each deposit
// to the memory in the background and applies the org chart on every question an expert asks.

const ALL = "";
const FIELD = "w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm font-normal text-ink focus-visible:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/15";

type AddKind = "note" | "documents" | "site";
const ADD_TITLE: Record<AddKind, string> = { note: "Une note", documents: "Des documents", site: "Un site web" };

// `embedded`: on Contexte. `logoTile` and `presentationTile`: the two other tiles of « L’essentiel », for an
// admin, set beside the brand book's (Leslie, 06/11: three tiles on top, the deposit form behind « Ajouter »).
export function MemoryView({
  embedded = false,
  onDeposit,
  logoTile,
  presentationTile,
}: {
  embedded?: boolean;
  onDeposit?: () => void;
  logoTile?: React.ReactNode;
  presentationTile?: React.ReactNode;
}) {
  const [adding, setAdding] = useState<AddKind | null>(null);
  const [list, setList] = useState<MemoryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<MemoryItem | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [unit, setUnit] = useState(ALL);
  const [files, setFiles] = useState<File[]>([]);
  const [sites, setSites] = useState<string[]>([]);
  const [site, setSite] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const chartePicker = useRef<HTMLInputElement>(null);
  const versionPicker = useRef<HTMLInputElement>(null);
  const [versionOf, setVersionOf] = useState<MemoryItem | null>(null);

  const load = useCallback(
    () =>
      apiFetch<MemoryList>("/api/memory/items")
        .then(setList)
        .catch((e: Error) => setError(e.message)),
    []
  );
  useEffect(() => void load(), [load]);

  // A deposit is sent in the background: read again while one is still on its way.
  const waiting = list?.items.some((i) => i.status === "pending") ?? false;
  // With the stream, the back office's `job.done` (memory) says when; without, a 15 s net.
  usePoll(load, { everyMs: 15_000, immediate: false, enabled: waiting, live: true, wake: { types: ["job.done"], kind: "memory" } });

  const targets = [...(list?.canDepositForAll ? [{ id: ALL, name: "Toute l’entreprise" }] : []), ...(list?.units.filter((u) => u.canDeposit) ?? [])];
  // The first compartment the member may deposit in, while none is chosen.
  const target = targets.some((t) => t.id === unit) ? unit : (targets[0]?.id ?? ALL);

  // The company's brand book, always on top: the Experts apply it to every deliverable (Leslie, 01/11).
  const charte = list?.items.find((i) => i.kind === "document" && /charte/i.test(i.title)) ?? null;
  // No brand book yet: Djénéba makes it, she is in every account (Leslie, 05/11: « tous les comptes n'ont pas
  // Koffi »). She hands it to Koffi when the team has him. The file may land in either one's Livrables.
  const { experts } = useExpertsContext();
  const plainKey = (k?: string | null) => (k ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const isExpert = (e: (typeof experts)[number], name: string) => [e.catalogueKey, e.driveFolder, e.profileId].some((k) => plainKey(k).includes(name));
  const koffi = experts.find((e) => isExpert(e, "koffi"));
  const designer = experts.find((e) => isExpert(e, "djeneba")) ?? koffi;
  const charteRequest =
    designer === koffi
      ? "/charte"
      : "Prépare la charte graphique de l’entreprise (logo, couleurs, polices, exemples) à partir de notre site et de nos documents, en PDF nommé « Charte graphique ».";
  // Koffi delivers the brand book in his Livrables (a file named « Charte… »); the admin makes it the
  // company's in one click (Leslie, 01/11: Koffi writes nothing in the memory himself). Shown while
  // there is no charte, or when his file is newer than the one deposited.
  const [made, setMade] = useState<{ path: string; name: string; modified: number } | null>(null);
  const [copying, setCopying] = useState(false);
  useEffect(() => {
    if (!designer) return;
    const plain = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const folders = [designer.driveFolder, designer.displayName, koffi?.driveFolder, koffi?.displayName, "koffi", "djeneba"].filter(Boolean).map((f) => plain(String(f)));
    driveTree(designer.agentId)
      .then((tree) => {
        const found = tree.entries
          .filter((e) => e.type === "file" && /charte/i.test(e.name) && folders.some((f) => plain(e.path).includes(`/livrables/${f}/`)))
          .sort((a, b) => Number(/\.pdf$/i.test(b.name)) - Number(/\.pdf$/i.test(a.name)) || b.modified - a.modified)[0];
        setMade(found ? { path: found.path, name: found.name, modified: found.modified } : null);
      })
      .catch(() => setMade(null));
  }, [designer, koffi]);
  const charteAt = charte?.sentAt ? Date.parse(charte.sentAt) / 1000 : 0;
  const offer = made && (!charte || (charteAt > 0 && made.modified > charteAt + 60)) ? made : null;
  async function adoptCharte() {
    if (!offer || !designer) return;
    setCopying(true);
    try {
      await apiFetch("/api/memory/charte", { method: "POST", body: JSON.stringify({ agentId: designer.agentId, path: offer.path, replace: charte?.id ?? null }) });
      toast.success("C’est la charte de l’entreprise : vos Experts l’appliquent désormais.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCopying(false);
    }
  }

  async function depositCharte(file: File) {
    if (tooLarge(file)) return void toast.error(tooBig("La charte"));
    if (charte) return newVersion(charte, file);
    const form = new FormData();
    form.set("title", "Charte graphique");
    form.set("file", file);
    const res = await fetch("/api/memory/items", { method: "POST", body: form });
    if (!res.ok) toast.error(res.status === 413 ? tooBig("La charte") : await readApiError(res, `La charte n’a pas pu être déposée (${LIMIT_MB} Mo au plus)`));
    await load();
  }

  // A new file for a deposited document: the back office keeps the old one as the previous version.
  async function newVersion(item: MemoryItem, file: File) {
    if (tooLarge(file)) return void toast.error(tooBig(`« ${file.name} »`).replace("Réduisez-la", "Réduisez-le"));
    const form = new FormData();
    form.set("file", file);
    const res = await fetch(`/api/memory/items/${item.id}/versions`, { method: "POST", body: form });
    if (!res.ok) toast.error(res.status === 413 ? tooBig("La nouvelle version") : await readApiError(res, `La nouvelle version n’a pas pu être déposée (${LIMIT_MB} Mo au plus)`));
    else toast.success(`${item.title} : nouvelle version déposée`);
    await load();
  }

  const siteUrl = (v: string) => (/^https?:\/\//i.test(v) ? v : `https://${v}`);
  // A typed address becomes a site to add; several sites may go at once.
  function addSite() {
    const v = site.trim();
    if (!v) return;
    if (!sites.includes(siteUrl(v))) setSites([...sites, siteUrl(v)]);
    setSite("");
  }

  // One kind at a time, from the « Ajouter » window: a note, documents (each on its own, a document takes
  // the title only when it is alone) or sites (an address typed but not yet added goes too).
  async function deposit(kind: AddKind) {
    setBusy(true);
    const failed: File[] = [];
    const unitId = target === ALL ? null : target;
    try {
      if (kind === "site") {
        const typed = site.trim() ? [siteUrl(site.trim())] : [];
        for (const url of [...new Set([...sites, ...typed])]) {
          await apiFetch("/api/memory/items", { method: "POST", body: JSON.stringify({ title: new URL(url).hostname.replace(/^www\./, ""), url, unit: unitId }) });
        }
        setSites([]);
        setSite("");
        setAdding(null);
      }
      if (kind === "note" && note.trim()) {
        await apiFetch("/api/memory/items", { method: "POST", body: JSON.stringify({ title, note, unit: unitId }) });
        setTitle("");
        setNote("");
        setAdding(null);
      }
      if (kind === "documents") {
        // Three documents at a time; the ones refused stay in the window, in their order.
        const sent = await runPool(files, 3, async (file) => {
          if (tooLarge(file)) {
            toast.error(`${file.name} : ${tooBig("ce document").replace(/^ce/, "Ce").replace("Réduisez-la", "Réduisez-le")}`);
            return false;
          }
          const form = new FormData();
          form.set("title", file.name);
          if (unitId) form.set("unit", unitId);
          form.set("file", file);
          const res = await fetch("/api/memory/items", { method: "POST", body: form });
          if (!res.ok) toast.error(`${file.name} : ${res.status === 413 ? `il dépasse ${LIMIT_MB} Mo, la taille maximale d’un envoi.` : await readApiError(res, "Le document n’a pas pu être déposé")}`);
          return res.ok;
        });
        sent.forEach((r, i) => {
          if (r.status === "rejected") toast.error(`${files[i].name} : ${(r.reason as Error).message}`);
          if (r.status === "rejected" || !r.value) failed.push(files[i]);
        });
        setFiles(failed);
        if (failed.length === 0) setAdding(null);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      await load();
      onDeposit?.();
    }
  }

  async function patch(item: MemoryItem, body: { active: boolean }) {
    try {
      await apiFetch(`/api/memory/items/${item.id}`, { method: "PATCH", body: JSON.stringify(body) });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="max-w-4xl">
      {list && (list.canDepositForAll || logoTile || presentationTile) && (
        <>
          <h2 className="mb-3 mt-6 text-[13px] font-bold uppercase tracking-wide text-ink-3">L’essentiel</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {logoTile}
            {list.canDepositForAll && (
              <EssentialTile
                icon={<Palette className="h-5 w-5" />}
                title="Charte graphique"
                done={!!charte}
                line={
                  offer && designer ? (
                    <a
                      href={`/api/agents/${designer.agentId}/files/content?path=${encodeURIComponent(offer.path)}&disposition=inline`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-brand-ink underline-offset-2 hover:underline"
                    >
                      {designer.displayName} a préparé {charte ? "une nouvelle version" : "votre charte"}
                    </a>
                  ) : charte ? (
                    <a href={`/api/memory/items/${charte.id}/file`} download className="underline-offset-2 hover:underline">
                      {charte.fileName ?? "Charte"}
                      {charte.version && charte.version > 1 ? `, version ${charte.version}` : ""}
                    </a>
                  ) : (
                    "Appliquée à chaque livrable"
                  )
                }
              >
                {offer && (
                  <Button size="sm" disabled={copying} onClick={() => void adoptCharte()}>
                    {copying && <Loader2 className="h-4 w-4 animate-spin" />}
                    En faire la charte
                  </Button>
                )}
                {!charte && !offer && designer && (
                  <Button asChild size="sm">
                    <Link href={`${expertPath(designer.agentId, designer.profileId)}/chat?q=${encodeURIComponent(charteRequest)}`}>La créer avec {designer.displayName}</Link>
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => chartePicker.current?.click()}>
                  {charte ? "Remplacer" : "Déposer"}
                </Button>
              </EssentialTile>
            )}
            {presentationTile}
          </div>
          <HiddenFileInput inputRef={chartePicker} onFiles={(picked) => picked[0] && void depositCharte(picked[0])} />
        </>
      )}

      <div className="mt-9 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {embedded ? (
            <h2 className="font-display text-[20px] font-bold tracking-tight text-ink">Mémoire de l’entreprise</h2>
          ) : (
            <h1 className="font-display text-[28px] font-bold tracking-tight text-ink">Mémoire de l’entreprise</h1>
          )}
          <p className="mt-0.5 text-sm text-ink-3">Chaque Expert lit ce que l’organigramme permet à son membre de lire.</p>
        </div>
        {list && targets.length > 0 && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button>
                <Plus className="h-4 w-4" /> Ajouter
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem onSelect={() => setAdding("note")}>
                <NotebookPen className="size-4 text-ink-3" /> Une note
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setAdding("documents");
                  picker.current?.click();
                }}
              >
                <FileText className="size-4 text-ink-3" /> Des documents
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAdding("site")}>
                <Globe className="size-4 text-ink-3" /> Un site web
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {error && <p className="mt-4 max-w-xl rounded-xl bg-ko-pale px-4 py-3 text-sm text-ko">{error}</p>}
      {!list && !error && <Loader2 className="mt-6 h-5 w-5 animate-spin text-ink-3" aria-label="Chargement" />}
      <HiddenFileInput inputRef={picker} onFiles={(picked) => setFiles([...files, ...Array.from(picked)])} />

      <Dialog open={adding !== null} onOpenChange={(open) => !open && !busy && setAdding(null)}>
        <DialogContent className="max-w-lg" aria-busy={busy}>
          <DialogTitle>{adding ? ADD_TITLE[adding] : ""}</DialogTitle>
          {adding === "note" && (
            <div className="grid gap-3">
              <Input aria-label="Titre" placeholder="Titre" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
              <textarea aria-label="Texte de la note" placeholder="Texte" className={`min-h-32 ${FIELD}`} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
          {adding === "documents" && (
            <div>
              <p className="text-[13px] text-ink-3">PDF ou texte, 4 Mo au plus chacun.</p>
              {files.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {files.map((f, i) => (
                    <li key={`${f.name}:${i}`} className="flex min-w-0 items-center gap-2 text-sm text-ink-2">
                      <FileText className="size-4 shrink-0 text-ink-3" />
                      <span className="truncate">{f.name}</span>
                      <Button type="button" variant="ghost" size="sm" aria-label={`Retirer ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                        <X className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => picker.current?.click()}>
                <Plus className="h-4 w-4" /> {files.length > 0 ? "Ajouter d’autres documents" : "Choisir des documents"}
              </Button>
            </div>
          )}
          {adding === "site" && (
            <div>
              <p className="text-[13px] text-ink-3">Relu chaque semaine par vos Experts.</p>
              {sites.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {sites.map((u) => (
                    <li key={u} className="inline-flex max-w-full items-center gap-1 rounded-full bg-soft py-1 pl-3 pr-1 text-sm text-ink-2">
                      <Globe className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                      <span className="truncate">{u.replace(/^https?:\/\//, "")}</span>
                      <button type="button" aria-label={`Retirer ${u}`} onClick={() => setSites(sites.filter((x) => x !== u))} className="grid size-6 place-items-center rounded-full hover:bg-soft-2">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex gap-2">
                <Input
                  value={site}
                  placeholder="unifood.ci"
                  aria-label="Adresse d’un site web"
                  onChange={(e) => setSite(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addSite();
                    }
                  }}
                />
                <Button type="button" variant="outline" size="sm" className="h-10" disabled={!site.trim()} onClick={addSite}>
                  <Plus className="h-4 w-4" /> Ajouter
                </Button>
              </div>
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <Picker
              label="Lisible par"
              placeholder="Toute l’entreprise"
              value={target}
              onChange={setUnit}
              groups={[{ options: targets.map((t) => ({ value: t.id, label: t.name })) }]}
              className="sm:h-10"
            />
            <Button
              disabled={
                busy ||
                (adding === "note" && (!note.trim() || !title.trim())) ||
                (adding === "documents" && files.length === 0) ||
                (adding === "site" && sites.length === 0 && !site.trim())
              }
              onClick={() => adding && void deposit(adding)}
            >
              {busy ? "Ajout en cours…" : "Ajouter"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {list && list.items.length === 0 && targets.length === 0 && (
        <p className="mt-6 rounded-[22px] border border-line bg-surface p-8 text-center text-sm text-ink-3">La mémoire est vide pour l’instant.</p>
      )}

      {list && (list.items.length > 0 || targets.length > 0) && (
        <MemoryGroups
          list={list}
          onAdd={(unitId, kind) => {
            setUnit(unitId ?? ALL);
            setAdding(kind);
            if (kind === "documents") picker.current?.click();
          }}
          onToggle={(item) => void patch(item, { active: !item.active })}
          onRemove={setRemoving}
          onNewVersion={(item) => {
            setVersionOf(item);
            versionPicker.current?.click();
          }}
        />
      )}
      <HiddenFileInput inputRef={versionPicker} onFiles={(picked) => versionOf && picked[0] && void newVersion(versionOf, picked[0])} />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Supprimer « ${removing?.title ?? ""} » ?`}
        description="Il est effacé de la mémoire des Experts. Cette action est définitive."
        confirmText="Supprimer"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          await apiFetch(`/api/memory/items/${removing.id}`, { method: "DELETE" });
          await load();
        }}
      />
    </div>
  );
}
