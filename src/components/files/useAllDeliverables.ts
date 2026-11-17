"use client";

import { useEffect, useMemo, useState } from "react";
import { useHydrated } from "@/components/useHydrated";
import { useServerReading, type ServerReading } from "@/components/useServerReading";
import { cached, remember, whenKept } from "@/lib/client-cache";
import { deliverableItems, type DeliverableItem } from "@/lib/deliverable-folders";
import { isArchived, splitVersions } from "@/lib/drive-versions";
import { seatFolderOf, type DriveTree } from "@/lib/drive-paths";
import { driveTree, onDriveChanged, seedDriveTree } from "@/lib/drive-store";
import { agentTabPath } from "@/lib/expert-tabs";
import { isNewAt, markSeenAt, parseSeen, type SeenMarks } from "@/lib/seen-deliverables";
import type { Expert } from "@/lib/types";

/** A deliverable with whoever made it: an Expert, or the chat d'entreprise (`expert` null). */
export interface Deliverable extends DeliverableItem {
  agentId: string;
  expert: Expert | null;
  /** Where a click leads: the folder in its Expert's Livrables. */
  href: string;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

// The Expert whose drive folder this is: the catalogue's folder name, else its first name or key.
function ownerOf(experts: Expert[], agentId: string, folder: string): Expert | null {
  const f = fold(folder);
  return (
    experts.find((e) => e.agentId === agentId && [e.driveFolder, e.displayName, e.catalogueKey].some((n) => n && fold(n) === f)) ?? null
  );
}

// A document's older versions stay in its folder, out of the list (Leslie, 02/11): « devis_v18 » only.
function latestOnly(items: DeliverableItem[]): DeliverableItem[] {
  const byFolder = new Map<string, DeliverableItem[]>();
  for (const i of items) {
    const at = i.path.slice(0, i.path.lastIndexOf("/"));
    byFolder.set(at, [...(byFolder.get(at) ?? []), i]);
  }
  const kept = new Set<DeliverableItem>();
  for (const group of byFolder.values()) {
    for (const i of splitVersions(group.map((g) => ({ ...g, type: g.folder ? "directory" : "file", item: g }))).current) kept.add(i.item);
  }
  return items.filter((i) => kept.has(i) && !isArchived(i.path));
}

// The same tree read again (a stream event that changed nothing) is not rebuilt.
const built = new WeakMap<DriveTree, { experts: Expert[]; rows: Deliverable[] }>();

function deliverablesOf(agentId: string, tree: DriveTree, experts: Expert[]): Deliverable[] {
  const kept = built.get(tree);
  if (kept?.experts === experts) return kept.rows;
  const rows = buildRows(agentId, tree, experts);
  built.set(tree, { experts, rows });
  return rows;
}

function buildRows(agentId: string, tree: DriveTree, experts: Expert[]): Deliverable[] {
  return latestOnly(deliverableItems(tree.entries ?? [])).flatMap((item): Deliverable[] => {
    const seat = seatFolderOf([item.owner]);
    const expert = seat ? null : ownerOf(experts, agentId, item.owner);
    // A folder that is no Expert's and not the chat d'entreprise's is the member's own.
    if (!seat && !expert) return [];
    const tab = agentTabPath(agentId, "files", expert?.profileId);
    const at = item.folder ? item.path : item.path.slice(0, item.path.lastIndexOf("/"));
    return [{ ...item, agentId, expert, href: `${tab}?dossier=${encodeURIComponent(at)}` }];
  });
}

const newestFirst = (all: Deliverable[][]) => all.flat().sort((a, b) => b.modified - a.modified);
// What the list shows: the same answer again keeps the same array, so nothing on screen is redrawn.
const signature = (rows: Deliverable[]) => rows.map((d) => `${d.agentId}|${d.path}|${d.modified}|${d.cover}|${d.coverModified}|${d.files}|${d.expert?.profileId ?? ""}`).join("\n");

/**
 * Every deliverable of the member's instances, newest first; null until read. `initial`: the drives the
 * page read on the server, by agent id, shown until the fresh reading replaces them.
 */
export function useAllDeliverables(ownAgentId: string | null, experts: Expert[], reading: ServerReading<Record<string, DriveTree>> = null): Deliverable[] | null {
  const { value: initial, settled } = useServerReading(reading);
  const agentIds = [...new Set([ownAgentId, ...experts.map((e) => e.agentId)].filter((a): a is string => !!a))];
  const key = `all-deliverables:${agentIds.join(",")}`;
  const [items, setItems] = useState<Deliverable[] | null>(() => cached<Deliverable[]>(key) ?? null);
  const [tick, setTick] = useState(0);
  const expertsKey = experts.map((e) => `${e.agentId}:${e.profileId}:${e.driveFolder ?? ""}`).join(",");
  const hydrated = useHydrated();
  const seed = useMemo(
    () => (initial && agentIds.length ? newestFirst(agentIds.map((a) => (initial[a] ? deliverablesOf(a, initial[a], experts) : []))) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initial, key, expertsKey]
  );

  useEffect(() => {
    // The drives the server read with the page are the store's first reading: not asked again.
    for (const a of agentIds) if (initial?.[a]) seedDriveTree(a, initial[a]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, initial]);
  useEffect(() => {
    const offs = agentIds.map((a) => onDriveChanged(a, () => setTick((t) => t + 1)));
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!agentIds.length) return;
    let live = true;
    // Nothing read with the page (or its reading still streaming in): the list this device last showed paints meanwhile.
    const offKept = seed ? () => undefined : whenKept<Deliverable[]>(key, (v) => live && setItems((i) => i ?? v));
    if (!settled)
      return () => {
        live = false;
        offKept();
      };
    void Promise.all(
      agentIds.map((agentId) =>
        // A tree that cannot be read or walked counts as empty: never a list stuck on « Chargement ».
        driveTree(agentId)
          .then((tree) => deliverablesOf(agentId, tree, experts))
          .catch(() => [] as Deliverable[])
      )
    ).then((all) => {
      const sorted = newestFirst(all);
      const prev = cached<Deliverable[]>(key);
      const next = prev && signature(prev) === signature(sorted) ? prev : sorted;
      remember(key, next);
      if (live) setItems(next);
    });
    return () => {
      live = false;
      offKept();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, expertsKey, tick, settled]);

  return items ?? (hydrated ? seed : null);
}

// « Nouveau »: changed in the last three days and not opened from this browser since (lib/seen-deliverables).
// The marks are read from storage once, not for every row on every render, and pruned when written.
const SEEN_KEY = "yelema.livrables-vus";
let seen: SeenMarks | null = null;

function seenMarks(): SeenMarks {
  if (seen) return seen;
  try {
    seen = parseSeen(localStorage.getItem(SEEN_KEY), Date.now());
  } catch {
    seen = {};
  }
  return seen;
}

// Another tab opened a deliverable: read the marks again.
if (typeof window !== "undefined") window.addEventListener("storage", (e) => e.key === SEEN_KEY && (seen = null));

export function isNew(d: Pick<Deliverable, "path" | "modified">): boolean {
  return isNewAt(seenMarks(), d, Date.now());
}

export function markSeen(d: Pick<Deliverable, "path">): void {
  seen = markSeenAt(seenMarks(), d.path, Date.now());
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {}
}
