"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";

// Whether the search is open: one store, so the menu's « Rechercher » and Ctrl K open the same one.
const listeners = new Set<() => void>();
let opened = false;
let warmed = false;
export function setSearchOpen(v: boolean) {
  opened = v;
  // Closed: the next hover or opening reads again (each space is kept 30 s).
  if (!v) warmed = false;
  listeners.forEach((l) => l());
}
export const openSearch = () => setSearchOpen(true);
// The pointer on « Rechercher »: the lists are read ahead, so they are there when it opens.
export function warmSearch() {
  if (warmed) return;
  warmed = true;
  listeners.forEach((l) => l());
}
export function useSearchWarm() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => warmed,
    () => false
  );
}
export function useSearchOpen() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => opened,
    () => false
  );
}

// The dialog and the file preview it opens load on first use (hover, « Rechercher », Ctrl K).
const SearchPanel = dynamic(() => import("./SearchPanel").then((m) => m.SearchPanel), { ssr: false });

export function SearchDialog() {
  const open = useSearchOpen();
  const warm = useSearchWarm();
  const [used, setUsed] = useState(false);
  if ((open || warm) && !used) setUsed(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return used ? <SearchPanel /> : null;
}
