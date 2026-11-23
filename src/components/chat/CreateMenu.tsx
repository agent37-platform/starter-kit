"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileText, Globe, Hand, LayoutDashboard, MonitorPlay, PenLine, RefreshCw, Smartphone, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CREATION_TYPE_LABEL, isOnDemand, type CreationModel, type CreationType } from "@/lib/creations";

const ICON: Record<CreationType, LucideIcon> = {
  suivi: LayoutDashboard,
  page: Globe,
  formulaire: FileText,
  "mini-app": Smartphone,
  presentation: MonitorPlay,
};

/**
 * « Créer » in the composer (maquette validated by Leslie, 19/11): the Expert's models, those that
 * keep themselves up to date first, then those made on request, and « Décrire autre chose ».
 */
export function CreateMenu({
  name,
  models,
  onPick,
  onOther,
}: {
  name: string;
  models: CreationModel[];
  onPick: (m: CreationModel) => void;
  onOther: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(520);

  useLayoutEffect(() => {
    if (!open) return;
    const top = wrapRef.current?.closest("[data-composer]")?.getBoundingClientRect().top ?? 600;
    setRoom(Math.max(200, Math.min(520, top - 84)));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const self = models.filter((m) => !isOnDemand(m));
  const asked = models.filter(isOnDemand);
  const row = (m: CreationModel) => {
    const Icon = ICON[m.type];
    return (
      <button
        key={m.name}
        type="button"
        role="menuitem"
        onClick={() => {
          setOpen(false);
          onPick(m);
        }}
        className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-soft focus-visible:bg-soft focus-visible:outline-none"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-bg text-ink-2">
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink">{m.name}</span>
          {!isOnDemand(m) && <span className="block text-xs text-ink-3">{m.update}</span>}
        </span>
        <span className="shrink-0 text-xs text-ink-3 max-sm:hidden">{CREATION_TYPE_LABEL[m.type]}</span>
      </button>
    );
  };
  const head = (Icon: LucideIcon, label: string) => (
    <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
      <Icon className="size-3.5" /> {label}
    </p>
  );

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Créer avec ${name}`}
        title={`Créer avec ${name}`}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
          open ? "border-brand/40 bg-tint text-brand-ink" : "border-brand/25 text-brand-ink hover:bg-tint",
          "max-sm:size-10 max-sm:justify-center max-sm:px-0"
        )}
      >
        <Sparkles className="size-4" />
        <span className="max-sm:sr-only">Créer</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Créer avec ${name}`}
          className="absolute bottom-[calc(100%+12px)] left-0 z-30 flex w-[440px] max-w-[calc(100vw-48px)] flex-col overflow-hidden rounded-[18px] border border-line bg-surface p-2 shadow-[0_18px_48px_rgb(23_17_43_/_0.14)]"
          style={{ maxHeight: room }}
        >
          <div className="min-h-0 overflow-y-auto">
            {self.length > 0 && head(RefreshCw, "Se met à jour seul")}
            {self.map(row)}
            {self.length > 0 && asked.length > 0 && <hr className="mx-1 my-1.5 border-line" />}
            {asked.length > 0 && head(Hand, "À la demande")}
            {asked.map(row)}
          </div>
          <hr className="mx-1 my-1.5 border-line" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOther();
            }}
            className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-sm font-medium text-ink hover:bg-soft"
          >
            <PenLine className="size-4 text-ink-2" /> Décrire autre chose
          </button>
        </div>
      )}
    </div>
  );
}
