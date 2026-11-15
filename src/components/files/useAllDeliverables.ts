"use client";

import { useEffect, useMemo, useState } from "react";
import { useHydrated } from "@/components/useHydrated";
import { cached, remember } from "@/lib/client-cache";
import { deliverableItems, type DeliverableItem } from "@/lib/deliverable-folders";
import { splitVersions } from "@/lib/drive-versions";
import { seatFolderOf, type DriveTree } from "@/lib/drive-paths";
import { driveTree, onDriveChanged } from "@/lib/drive-store";
import { agentTabPath } from "@/lib/expert-tabs";
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
  return items.filter((i) => kept.has(i));
}

function deliverablesOf(agentId: string, tree: DriveTree, experts: Expert[]): Deliverable[] {
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

/**
 * Every deliverable of the member's instances, newest first; null until read. `initial`: the drives the
 * page read on the server, by agent id, shown until the fresh reading replaces them.
 */
export function useAllDeliverables(ownAgentId: string | null, experts: Expert[], initial: Record<string, DriveTree> | null = null): Deliverable[] | null {
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
    const offs = agentIds.map((a) => onDriveChanged(a, () => setTick((t) => t + 1)));
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!agentIds.length) return;
    let live = true;
    void Promise.all(
      agentIds.map((agentId) =>
        // A tree that cannot be read or walked counts as empty: never a list stuck on « Chargement ».
        driveTree(agentId)
          .then((tree) => deliverablesOf(agentId, tree, experts))
          .catch(() => [] as Deliverable[])
      )
    ).then((all) => {
      const sorted = newestFirst(all);
      remember(key, sorted);
      if (live) setItems(sorted);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, expertsKey, tick]);

  return items ?? (hydrated ? seed : null);
}

// « Nouveau »: changed in the last three days and not opened from this browser since.
const SEEN_KEY = "yelema.livrables-vus";
const FRESH_MS = 3 * 24 * 3600 * 1000;

function seenMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function isNew(d: Pick<Deliverable, "path" | "modified">): boolean {
  if (!d.modified || Date.now() - d.modified > FRESH_MS) return false;
  const seen = seenMap()[d.path];
  return !seen || seen < d.modified;
}

export function markSeen(d: Pick<Deliverable, "path">): void {
  try {
    const all = seenMap();
    all[d.path] = Date.now();
    localStorage.setItem(SEEN_KEY, JSON.stringify(all));
  } catch {}
}
