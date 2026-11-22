"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { setChatSidePanel } from "@/components/chat/chat-layout";
import Image from "next/image";
import { BarChart3, Download, ExternalLink, FileCode, FileText, Loader2, Maximize2, Minimize2, Presentation, RefreshCw, Share2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useDashboard } from "./DashboardProvider";
import { useComputer } from "./ComputerProvider";
import { ShareDashboardModal } from "./ShareDashboardModal";

export { ShareDashboardModal };

const WIDE = "(min-width: 85rem)";

function formatMajDate(dateStr?: string | null): string | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return `Mis à jour le ${d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
    }
  } catch {}
  return `Mis à jour : ${dateStr}`;
}

// `inHeader`: in the expert's own header (Leslie, 28/10, variante B), a short word on a computer, the
// icon alone on a phone; the panel still opens beside the chat.
export function useToggleDashboard() {
  const { panelOpen, setPanelOpen, dialogOpen, setDialogOpen } = useDashboard();
  const comp = useComputer();
  return () => {
    const isWide = typeof window !== "undefined" && window.matchMedia(WIDE).matches;
    if (isWide) {
      // One panel beside the chat at a time.
      if (!panelOpen) comp?.setPanelOpen(false);
      setPanelOpen(!panelOpen);
    } else {
      setDialogOpen(!dialogOpen);
    }

    // Opening never sends /tableau by itself (Leslie, 03/11: « beaucoup de commandes tableaux lancés »).
    // The link was checked before the panel had read the dashboard, so every click on a conversation
    // without the link started a new « /tableau » conversation. The panel reads it, and offers
    // « Préparer le tableau de bord » only when there is none.
  };
}

export function DashboardButton() {
  const { profile, panelOpen, isGenerating } = useDashboard();
  const comp = useComputer();
  const toggle = useToggleDashboard();
  if (!profile) return null;
  return (
    <button
      type="button"
      title="Tableau de bord"
      aria-label="Tableau de bord"
      onClick={toggle}
      // Same size and weight as « Son ordinateur » and « Nouvelle conversation » beside it.
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border bg-card px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-soft",
        (panelOpen || isGenerating) && "wide:border-brand/30 wide:bg-soft-2 wide:text-brand-ink"
      )}
    >
      {isGenerating ? <Loader2 className="h-4 w-4 animate-spin text-brand" /> : <BarChart3 className="h-4 w-4" />}
      <span className={cn("hidden sm:inline", (panelOpen || Boolean(comp?.panelOpen)) && "wide:hidden")}>{isGenerating ? "Génération…" : "Tableau de bord"}</span>
    </button>
  );
}

// The same, in the header's « … ».
export function DashboardMenuItem() {
  const { profile, isGenerating } = useDashboard();
  const toggle = useToggleDashboard();
  if (!profile) return null;
  return <DashboardMenuFace generating={isGenerating} onSelect={toggle} />;
}

// The menu line alone: also in the header before the expert's chat has ever been opened.
export function DashboardMenuFace({ generating = false, onSelect }: { generating?: boolean; onSelect: () => void }) {
  return (
    <DropdownMenuItem className="min-h-11 gap-2.5 rounded-[10px] px-2.5 text-sm" onSelect={onSelect}>
      {generating ? <Loader2 className="h-4 w-4 animate-spin text-brand" /> : <BarChart3 className="h-4 w-4" />}
      {generating ? "Génération…" : "Tableau de bord"}
    </DropdownMenuItem>
  );
}

// Opens the dashboard once the chat is up, as a click on its button would: after the provider's own mount reset.
export function OpenDashboardOnMount({ onDone }: { onDone: () => void }) {
  const toggle = useToggleDashboard();
  const done = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => {
      if (done.current) return;
      done.current = true;
      toggle();
      onDone();
    }, 0);
    return () => clearTimeout(t);
  });
  return null;
}

function DashboardHeaderControls({
  maximized,
  onMaximize,
  onClose,
}: {
  maximized?: boolean;
  onMaximize?: () => void;
  onClose?: () => void;
}) {
  const { embedUrl, refresh, loading, data, activeTab, setActiveTab, setShareModalOpen, downloadPdf, downloadHtml, downloadPptx } = useDashboard();
  const icon = "h-9 w-9 text-ink-3 hover:text-ink";

  return (
    <div className="flex shrink-0 items-center gap-1">
      {data?.isDjeneba && (
        <div className="mr-2 inline-flex rounded-lg border border-line bg-soft p-0.5 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab("equipe")}
            className={cn(
              "rounded-md px-2.5 py-1 transition-all",
              activeTab === "equipe" ? "bg-surface text-ink shadow-sm font-semibold" : "text-ink-3 hover:text-ink"
            )}
          >
            Tous les tableaux
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("metier")}
            className={cn(
              "rounded-md px-2.5 py-1 transition-all",
              activeTab === "metier" ? "bg-surface text-ink shadow-sm font-semibold" : "text-ink-3 hover:text-ink"
            )}
          >
            Direction
          </button>
        </div>
      )}

      {/* Reload, share, download (Leslie, 29/10: a Download button rather than « … »), enlarge, close. */}
      <Button variant="ghost" size="icon" className={icon} onClick={() => void refresh()} disabled={loading} title="Actualiser" aria-label="Actualiser">
        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
      </Button>

      <Button variant="ghost" size="icon" className={icon} onClick={() => setShareModalOpen(true)} title="Partager" aria-label="Partager">
        <Share2 className="h-4 w-4" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className={icon} title="Télécharger" aria-label="Télécharger">
            <Download className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60 p-1.5">
          <div className="px-2 py-1.5 text-xs font-semibold text-ink-3">Télécharger</div>
          <ExportItem icon={<FileText className="size-4" />} tone="bg-orange-500/10 text-orange-600" label="PDF" hint="A4 paysage, prêt à imprimer" onSelect={downloadPdf} />
          <ExportItem icon={<Presentation className="size-4" />} tone="bg-red-500/10 text-red-600" label="PowerPoint" hint="Une diapositive par bloc" onSelect={downloadPptx} />
          <ExportItem icon={<FileCode className="size-4" />} tone="bg-blue-500/10 text-blue-600" label="HTML" hint="Page web autonome" onSelect={downloadHtml} />
          {/* Always this app's own sandboxed frame, never the page's host. */}
          {embedUrl?.startsWith("/api/dashboards/frame") && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="gap-2.5 rounded-lg px-2.5 py-2 text-[13px]">
                <a href={embedUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4 text-ink-3" /> Ouvrir dans un nouvel onglet
                </a>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {onMaximize && (
        <Button variant="ghost" size="icon" className={icon} onClick={onMaximize} title={maximized ? "Réduire" : "Agrandir"} aria-label={maximized ? "Réduire" : "Agrandir"}>
          {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
      )}

      {onClose && (
        <Button variant="ghost" size="icon" className={icon} onClick={onClose} title="Fermer" aria-label="Fermer">
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function ExportItem({ icon, tone, label, hint, onSelect }: { icon: ReactNode; tone: string; label: string; hint: string; onSelect: () => void }) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-ink">
      <span className={cn("flex size-7 items-center justify-center rounded-md", tone)}>{icon}</span>
      <span>
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        <span className="block text-[11px] text-ink-3">{hint}</span>
      </span>
    </DropdownMenuItem>
  );
}

function DashboardHeader({
  maximized,
  onMaximize,
  onClose,
}: {
  maximized?: boolean;
  onMaximize?: () => void;
  onClose?: () => void;
}) {
  const { agentName, data, activeTab } = useDashboard();
  const isEquipeTab = activeTab === "equipe" && data?.isDjeneba;
  const title = isEquipeTab ? "Tableaux de bord de l'équipe" : data?.title || `Tableau de bord de ${agentName}`;
  const description = isEquipeTab ? "Vue d'ensemble des Experts de l'équipe" : data?.role || null;
  const majFormatted = formatMajDate(data?.maj);

  return (
    // The last button (✕) kept off the corner (Leslie, 20/11).
    <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line pl-4 pr-6">
      <div className="min-w-0 pr-2">
        <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
        <div className="flex min-w-0 items-center gap-2 text-xs text-ink-3">
          {description && <span className="truncate">{description}</span>}
          {description && majFormatted && <span aria-hidden>•</span>}
          {majFormatted && <span className="truncate">{majFormatted}</span>}
        </div>
      </div>
      <DashboardHeaderControls maximized={maximized} onMaximize={onMaximize} onClose={onClose} />
    </div>
  );
}

/** Under every dashboard, as on every Yelema document. */
function PoweredBy() {
  return (
    <a
      href="https://yelema.ai"
      target="_blank"
      rel="noopener"
      className="flex shrink-0 items-center justify-center gap-2 border-t border-line bg-surface py-2.5 text-xs text-ink-3"
    >
      Powered by
      <Image src="/yelema-long.png" alt="Yelema" width={55} height={16} className="h-4 w-auto" />
    </a>
  );
}

function DashboardContent() {
  const { embedUrl, loading, isGenerating, triggerGeneration, data } = useDashboard();

  if (loading && !embedUrl) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
        <Loader2 className="mb-2 h-8 w-8 animate-spin text-brand" />
        <p className="text-xs text-ink-3">Chargement du tableau de bord…</p>
      </div>
    );
  }

  if (!embedUrl) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
        <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-soft text-ink-3">
          <BarChart3 className="size-6 text-brand" />
        </div>
        <h3 className="mb-1 text-sm font-semibold text-ink">{data?.title || "Pas encore de tableau de bord"}</h3>
        <p className="mb-4 max-w-xs text-xs text-ink-3">{data?.role || "Aucun tableau de bord n'a encore été préparé pour cet Expert."}</p>
        <Button size="sm" onClick={() => void triggerGeneration()} disabled={isGenerating} className="gap-2">
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Préparation en cours…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Préparer le tableau de bord
            </>
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div className="relative flex-1 overflow-hidden bg-surface">
        <iframe
          src={embedUrl}
          // aria-label, not title: Chrome shows an iframe's title as a tooltip over the page's own header.
          aria-label="Tableau de bord"
          className="h-full w-full border-0 bg-transparent"
          sandbox="allow-scripts allow-popups allow-downloads"
        />
      </div>
      <PoweredBy />
    </div>
  );
}

// Beside the chat, one panel at a time: opening « Son ordinateur » closes the dashboard (the
// dashboard's button closes the computer). While one is open the conversations fold away.
export function SidePanelSync({ hasComputer }: { hasComputer: boolean }) {
  const { panelOpen, setPanelOpen } = useDashboard();
  const comp = useComputer();
  const computerOpen = hasComputer && Boolean(comp?.panelOpen);
  const prev = useRef(computerOpen);
  useEffect(() => {
    if (computerOpen && !prev.current) setPanelOpen(false);
    prev.current = computerOpen;
  }, [computerOpen, setPanelOpen]);
  useEffect(() => {
    setChatSidePanel(panelOpen || computerOpen);
    return () => setChatSidePanel(false);
  }, [panelOpen, computerOpen]);
  return null;
}

export function DashboardPanel() {
  const { profile, panelOpen, setPanelOpen, setDialogOpen } = useDashboard();
  if (!profile || !panelOpen) return null;

  return (
    <aside
      aria-label="Tableau de bord métier"
      // Beside the chat, the same width as « Son ordinateur » (Leslie, 25/10), never over the chat.
      className="hidden max-w-[900px] shrink basis-[60%] flex-col border-l border-line bg-card wide:flex"
    >
      <DashboardHeader
        onMaximize={() => {
          setPanelOpen(false);
          setDialogOpen(true);
        }}
        onClose={() => setPanelOpen(false)}
      />
      <DashboardContent />
    </aside>
  );
}

/**
 * Enlarged (and on narrow screens): the dashboard takes the whole working area beside the menu,
 * not a window over the page. « Réduire » brings back the side panel where there is room for one.
 */
export function DashboardDialog() {
  const { profile, dialogOpen, setDialogOpen, setPanelOpen } = useDashboard();
  useEffect(() => {
    if (!dialogOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDialogOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen, setDialogOpen]);
  if (!profile || !dialogOpen) return null;
  const wide = typeof window !== "undefined" && window.matchMedia(WIDE).matches;

  return (
    <section
      role="region"
      aria-label="Tableau de bord métier"
      className="fixed inset-y-0 right-0 left-0 z-40 flex flex-col bg-card md:left-[var(--shell-nav,0px)] md:border-l md:border-line"
    >
      <DashboardHeader
        maximized
        onMaximize={
          wide
            ? () => {
                setDialogOpen(false);
                setPanelOpen(true);
              }
            : undefined
        }
        onClose={() => setDialogOpen(false)}
      />
      <DashboardContent />
    </section>
  );
}
