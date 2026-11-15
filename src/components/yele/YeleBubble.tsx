"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useExpertsContext } from "@/components/experts/ExpertsProvider";
import { useCallState } from "@/components/voice/CallProvider";
import { cn } from "@/lib/utils";
import { Portrait } from "./YelePortrait";

// The panel (chat, Markdown) loads on first opening; the pointer on a button starts the download.
const loadPanel = () => import("./YelePanel");
const preload = () => void loadPanel();
const Panel = dynamic(() => loadPanel().then((m) => m.YelePanel), { ssr: false });

// Yélé's bubble, on every screen of the app — only where her profile is installed on the user's
// instance: without it there is no bubble, never a fallback on another profile.
// On a phone, an expert's page has no free corner (the composer fills the width, centred or docked):
// Yélé sits in the top bar instead, and this event opens her.
const OPEN_EVENT = "yelema:open-yele";

// The experts come with the server page, so the bubble is in its HTML before React listens: a tap
// then is lost (3 times out of 3 on Mstudio). It shows only once the page answers.
const noop = () => () => {};
const useHydrated = () => useSyncExternalStore(noop, () => true, () => false);

export function YeleTopButton() {
  const { companion } = useExpertsContext();
  const hydrated = useHydrated();
  // On a phone Yélé always lives in the top bar: a round fixed in the corner would sit on the buttons
  // of whatever row scrolls under it.
  if (!companion || !hydrated) return null;
  return (
    <button
      type="button"
      onPointerDown={preload}
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      aria-label="Ouvrir Yélé, accompagnement"
      className="grid size-11 shrink-0 place-items-center rounded-full sm:hidden"
    >
      <Portrait />
    </button>
  );
}

export function YeleBubble() {
  const { companion } = useExpertsContext();
  const [open, setOpen] = useState(false);
  // An expert's workspace keeps its chat composer at the bottom: there the bubble is a round in the
  // corner, beside the composer (which leaves it the room), never on its Envoyer button. On a phone it
  // is in the top bar on every page (YeleTopButton).
  const raised = usePathname()?.startsWith("/experts/") ?? false;
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);
  // Escape closes the panel, as it closes any window laid over the page.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  // A folded call floats in the same corner on a computer (on a phone it is a strip at the top).
  const { folded } = useCallState();
  const hydrated = useHydrated();
  if (!companion || !hydrated) return null;
  return (
    <>
      <button
        type="button"
        onPointerEnter={preload}
        onFocus={preload}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Fermer Yélé" : "Ouvrir Yélé, accompagnement"}
        aria-expanded={open}
        className={cn("fixed right-6 z-50 flex items-center gap-2.5 rounded-full border border-line bg-surface p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.16)] transition-transform hover:scale-105", "max-sm:hidden", "bottom-6", folded && "sm:bottom-32", open && "hidden")}
      >
        <Portrait animated={open} />
        {!open && !raised && <span className="hidden pr-3 text-xs font-semibold text-ink sm:inline">Yélé</span>}
      </button>
      {open && <Panel key={companion.agentId} companion={companion} folded={folded} onClose={() => setOpen(false)} />}
    </>
  );
}
