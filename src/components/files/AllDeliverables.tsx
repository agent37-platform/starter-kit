"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, FileText, Folder, Grid2X2, List, Lock, Search, Users, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BackButton } from "@/components/ui/back-button";
import { ExpertAvatar } from "@/components/experts/ExpertAvatar";
import { useExpertsContext } from "@/components/experts/ExpertsProvider";
import { useOwnAgentId } from "@/components/conversations/useAllConversations";
import { Preview as DocPreview } from "@/components/chat/DocumentCards";
import { ReducedImage } from "@/components/files/FilePreview";
import { FilePreview } from "@/components/files/FilePreview";
import { contentUrl, formatMtime, thumbUrl, type FileEntry } from "@/components/files/types";
import { isNew, markSeen, useAllDeliverables, type Deliverable } from "@/components/files/useAllDeliverables";
import type { DriveTree } from "@/lib/drive-paths";
import type { ServerReading } from "@/components/useServerReading";
import { docKind } from "@/lib/drive-links";
import { expertCycle } from "@/lib/expert-cycle";
import { matchesDriveQuery } from "@/lib/drive-order";
import type { Expert } from "@/lib/types";
import { cn } from "@/lib/utils";

const ALL = "all";
const COMPANY = "entreprise";
const expertId = (e: Expert) => `${e.agentId}:${e.profileId}`;

// Every deliverable in one list (Myriel, Leslie 30/10), opened by « Voir tous » under the home's
// latest deliverables, never from the menu. One row per subject, the Expert who made it as a column
// and as a filter, newest first. A folder opens in its Expert's Livrables, a loose file in its preview.
export function AllDeliverables({ initial = null }: { initial?: ServerReading<Record<string, DriveTree>> }) {
  const router = useRouter();
  const ownAgentId = useOwnAgentId();
  const { experts } = useExpertsContext();
  const all = useAllDeliverables(ownAgentId, experts, initial);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [onlyNew, setOnlyNew] = useState(false);
  const [who, setWho] = useState<string>(ALL);
  // The gallery first (Leslie, 16/11: « plus en grille médias »), the list one click away.
  const [mode, setMode] = useState<"list" | "grid">("grid");
  // Pictures apart from documents, like a phone's gallery; a project holds both and stays in both.
  const [kind, setKind] = useState<"all" | "media" | "docs" | "creations">("all");
  const [preview, setPreview] = useState<{ agentId: string; entry: FileEntry } | null>(null);
  // Read once per render of the list: « Nouveau » is the browser's own memory of what was opened.
  const [, setSeenTick] = useState(0);

  // Only the Experts who made something are offered as a filter.
  const makers = useMemo(() => {
    const ids = new Set((all ?? []).map((d) => (d.expert ? expertId(d.expert) : COMPANY)));
    return { experts: experts.filter((e) => ids.has(expertId(e))), company: ids.has(COMPANY) };
  }, [all, experts]);
  const chosen = who === ALL || who === COMPANY ? null : experts.find((e) => expertId(e) === who) ?? null;

  const shown = useMemo(() => {
    const rows = (all ?? []).filter(
      (d) =>
        (who === ALL || (who === COMPANY ? !d.expert : d.expert && expertId(d.expert) === who)) &&
        (!onlyNew || isNew(d)) &&
        (kind === "all" || (kind === "creations" ? isCreation(d.path) : !isCreation(d.path) && (d.folder || (kind === "media") === isMedia(d.name)))) &&
        matchesDriveQuery(d.name, query)
    );
    return sort === "name" ? [...rows].sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base", numeric: true })) : rows;
  }, [all, who, onlyNew, kind, query, sort]);

  function open(d: Deliverable) {
    markSeen(d);
    setSeenTick((t) => t + 1);
    if (d.folder) router.push(d.href);
    else setPreview({ agentId: d.agentId, entry: { name: d.name, path: d.path, type: "file", size: null, modified: d.modified } as FileEntry });
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 pt-6 pb-28 sm:px-8">
      <BackButton label="Accueil" onClick={() => router.push("/")} />
      <h1 className="mt-4 font-display text-[28px] font-bold tracking-tight text-ink sm:text-[32px]">Livrables</h1>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-line bg-surface px-3 sm:w-auto sm:max-w-sm sm:flex-1">
          <Search className="size-4 shrink-0 text-ink-3" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un livrable"
            aria-label="Rechercher un livrable"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Effacer la recherche" className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-soft">
              <X className="size-4" />
            </button>
          )}
        </label>
        <div role="radiogroup" aria-label="Trier" className="flex h-11 items-center rounded-xl border border-line bg-surface p-1 text-sm">
          {(
            [
              ["recent", "Plus récent"],
              ["name", "A à Z"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={sort === v}
              onClick={() => setSort(v)}
              className={cn("h-full rounded-lg px-3 font-semibold", sort === v ? "bg-soft-2 text-ink" : "text-ink-3 hover:text-ink")}
            >
              {label}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Affichage" className="ml-auto flex h-11 items-center rounded-xl border border-line bg-surface p-1">
          {(
            [
              ["list", List, "Liste"],
              ["grid", Grid2X2, "Grille"],
            ] as const
          ).map(([v, Icon, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={mode === v}
              aria-label={label}
              title={label}
              onClick={() => setMode(v)}
              className={cn("grid h-full w-10 place-items-center rounded-lg", mode === v ? "bg-soft-2 text-ink" : "text-ink-3 hover:text-ink")}
            >
              <Icon className="size-4" />
            </button>
          ))}
        </div>
      </div>

      {/* One row of filters, scrolled sideways on a phone rather than stacked. */}
      <div className="-mx-4 mt-3 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0 [&>*]:shrink-0">
        {(
          [
            [false, "Tous"],
            [true, "Nouveaux"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={label}
            type="button"
            aria-pressed={onlyNew === v}
            onClick={() => setOnlyNew(v)}
            className={cn(
              "h-10 rounded-full border px-4 text-[13px] font-semibold",
              onlyNew === v ? "border-ink bg-ink text-surface" : "border-line bg-surface text-ink-2 hover:bg-soft"
            )}
          >
            {label}
          </button>
        ))}
        <span className="mx-1 h-6 w-px bg-line max-sm:hidden" aria-hidden />
        <div role="radiogroup" aria-label="Type" className="flex h-10 items-center rounded-full border border-line bg-surface p-1 text-[13px]">
          {(
            [
              ["all", "Tout"],
              ["media", "Médias"],
              ["docs", "Documents"],
              // The online tools an Expert builds (« Créer »), kept in Livrables/<Expert>/Créations (Leslie, 19/11).
              ...((all ?? []).some((d) => isCreation(d.path)) ? ([["creations", "Créations"]] as const) : []),
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={kind === v}
              onClick={() => setKind(v)}
              className={cn("h-full rounded-full px-3 font-semibold", kind === v ? "bg-soft-2 text-ink" : "text-ink-3 hover:text-ink")}
            >
              {label}
            </button>
          ))}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-full border pl-1.5 pr-3 text-[13px] font-semibold",
                who === ALL ? "border-line bg-surface text-ink-2 hover:bg-soft" : "border-brand bg-tint text-brand-ink"
              )}
            >
              {chosen ? (
                <ExpertAvatar expert={{ ...chosen, gateway: null }} size="xs" />
              ) : (
                <span className="grid size-7 place-items-center rounded-full bg-soft-2 text-ink-2">
                  {who === COMPANY ? <Lock className="size-3.5" /> : <Users className="size-3.5" />}
                </span>
              )}
              {chosen ? chosen.displayName : who === COMPANY ? "Chat d’entreprise" : "Tous les Experts"}
              <ChevronDown className="size-4 text-ink-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[60vh] w-64 overflow-y-auto">
            <WhoItem active={who === ALL} onSelect={() => setWho(ALL)} icon={<Users className="size-4" />} label="Tous les Experts" />
            {makers.company && <WhoItem active={who === COMPANY} onSelect={() => setWho(COMPANY)} icon={<Lock className="size-4" />} label="Chat d’entreprise" />}
            {makers.experts.map((e) => (
              <WhoItem
                key={expertId(e)}
                active={who === expertId(e)}
                onSelect={() => setWho(expertId(e))}
                icon={<ExpertAvatar expert={{ ...e, gateway: null }} size="xs" />}
                label={e.displayName}
                hint={expertCycle(e)?.name}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-5">
        {all === null ? (
          <p className="py-10 text-center text-sm text-ink-3">Chargement des livrables…</p>
        ) : shown.length === 0 ? (
          <p className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line py-14 text-center text-sm text-ink-3">
            <Folder className="size-6" />
            {all.length === 0 ? "Les livrables de vos Experts apparaîtront ici." : "Aucun livrable ne correspond."}
          </p>
        ) : mode === "list" ? (
          <ul className="overflow-hidden rounded-card border border-line bg-surface">
            <li className="hidden grid-cols-[minmax(0,1fr)_180px_110px_170px] gap-4 border-b border-line px-4 py-2.5 text-xs font-semibold text-ink-3 md:grid">
              <span>Nom</span>
              <span>Expert</span>
              <span>Contenu</span>
              <span>Modifié le</span>
            </li>
            {shown.map((d) => (
              <li key={`${d.agentId}:${d.path}`} className="border-b border-line last:border-0">
                <button
                  type="button"
                  onClick={() => open(d)}
                  className="grid min-h-16 w-full grid-cols-[minmax(0,1fr)] items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-soft md:grid-cols-[minmax(0,1fr)_180px_110px_170px]"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-tint text-brand-ink">
                      {d.folder ? <Folder className="size-5" /> : <FileText className="size-5" />}
                    </span>
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-semibold text-ink">{d.name}</span>
                        {isNew(d) && <NewBadge />}
                      </span>
                      {/* On a phone the other columns fold under the name. */}
                      <span className="block truncate text-xs text-ink-3 md:hidden">
                        {who === ALL && `${maker(d)} · `}
                        {count(d)} · {formatMtime(d.modified)}
                      </span>
                    </span>
                  </span>
                  <Maker d={d} className="hidden md:flex" />
                  <span className="hidden text-sm text-ink-2 md:block">{count(d)}</span>
                  <span className="hidden text-sm text-ink-2 md:block">{formatMtime(d.modified)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          // Projects first, as folders with their cover, then the loose files by month (Leslie, 16/11: « le meilleur des deux »).
          <div className="flex flex-col gap-7">
            {[
              ["Projets", shown.filter((d) => d.folder)] as const,
              // Sorted A to Z, the files stay in one block: months would break the order.
              ...(sort === "name" ? [["Fichiers", shown.filter((d) => !d.folder)] as const] : byMonth(shown.filter((d) => !d.folder))),
            ]
              .filter(([, rows]) => rows.length > 0)
              .map(([title, rows]) => (
                <section key={title}>
                  <h2 className="mb-2.5 flex items-baseline justify-between text-[15px] font-semibold text-ink">
                    {title}
                    {title === "Projets" && <span className="text-[13px] font-normal text-ink-3">{rows.length}</span>}
                  </h2>
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] sm:gap-3">
                    {rows.map((d) => (
                      <li key={`${d.agentId}:${d.path}`}>
                        <button type="button" onClick={() => open(d)} className="flex w-full flex-col overflow-hidden rounded-card border border-line bg-surface text-left hover:border-brand/40">
                          <span className="relative block aspect-[4/3] overflow-hidden bg-soft">
                            <Cover d={d} />
                            {isNew(d) && <NewBadge className="absolute left-2.5 top-2.5" />}
                          </span>
                          <span className="flex flex-col gap-1 p-3">
                            <span className="truncate text-sm font-semibold text-ink">{d.name}</span>
                            {who === ALL && <Maker d={d} />}
                            <span className="truncate text-xs text-ink-3">
                              {d.folder ? `${count(d)} · ` : ""}
                              {formatMtime(d.modified)}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        )}
      </div>
      {preview && <FilePreview agentId={preview.agentId} entry={preview.entry} onClose={() => setPreview(null)} />}
    </div>
  );
}

/** A Création is its own folder under « Créations » in the Expert's drive. */
const isCreation = (path: string) => /(^|\/)Cr[ée]ations\//i.test(path);
const isMedia = (name: string) => docKind(name) === "image" || /\.(mp4|mov|webm|m4v)$/i.test(name);

// « Cette semaine », then one heading per month, newest first.
function byMonth(rows: Deliverable[]): (readonly [string, Deliverable[]])[] {
  const weekAgo = Date.now() - 7 * 86_400_000;
  const groups = new Map<string, Deliverable[]>();
  for (const d of [...rows].sort((a, b) => b.modified - a.modified)) {
    const at = new Date(d.modified);
    const key =
      d.modified >= weekAgo
        ? "Cette semaine"
        : at.toLocaleDateString("fr-FR", { month: "long", ...(at.getFullYear() !== new Date().getFullYear() && { year: "numeric" }) });
    const label = key.charAt(0).toUpperCase() + key.slice(1);
    groups.set(label, [...(groups.get(label) ?? []), d]);
  }
  return [...groups.entries()];
}

const maker = (d: Deliverable) => d.expert?.displayName ?? "Chat d’entreprise";
const count = (d: Deliverable) => (d.folder ? (d.files === 1 ? "1 fichier" : `${d.files} fichiers`) : "1 fichier");

function Maker({ d, className }: { d: Deliverable; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2 text-sm text-ink-2", className)}>
      {d.expert ? (
        <ExpertAvatar expert={{ ...d.expert, gateway: null }} size="xs" />
      ) : (
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-tint text-brand-ink">
          <Lock className="size-3.5" />
        </span>
      )}
      <span className="truncate">{maker(d)}</span>
    </span>
  );
}

function NewBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full bg-tint px-2 py-0.5 text-[11px] font-semibold text-brand-ink", className)}>
      <span className="size-1.5 rounded-full bg-brand" aria-hidden /> Nouveau
    </span>
  );
}

// The cover is the real thing: a picture reduced on the server, a PDF's or document's first page.
function Cover({ d }: { d: Deliverable }) {
  const [failed, setFailed] = useState(false);
  const icon = (
    <span className="grid size-full place-items-center text-brand-ink">
      {d.folder ? <Folder className="size-9" /> : <FileText className="size-9" />}
    </span>
  );
  if (!d.cover || failed) return icon;
  const name = d.cover.split("/").pop()!;
  const kind = docKind(name);
  if (kind === "image")
    return <ReducedImage thumb={thumbUrl(d.agentId, d.cover, 480, d.coverModified)} original={thumbUrl(d.agentId, d.cover, 480)} alt="" className="size-full object-cover" onFail={() => setFailed(true)} />;
  if (kind === "video")
    return (
      <video
        src={contentUrl(d.agentId, d.cover, "inline")}
        className="size-full object-cover"
        muted
        preload="metadata"
      />
    );
  return (
    <span className="pointer-events-none block size-full">
      <DocPreview agentId={d.agentId} doc={{ name, path: d.cover, size: null, modified: d.coverModified, kind }} />
    </span>
  );
}

function WhoItem({ active, onSelect, icon, label, hint }: { active: boolean; onSelect: () => void; icon: React.ReactNode; label: string; hint?: string }) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="gap-2.5">
      <span className="grid size-7 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
      {active && <Check className="size-4 text-brand-ink" />}
    </DropdownMenuItem>
  );
}
