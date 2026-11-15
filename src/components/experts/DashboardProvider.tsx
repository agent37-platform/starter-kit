"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo, type ReactNode } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { isTrustedDashboardUrl as isTrustedFrameUrl } from "@/lib/dashboards";
import { usePoll } from "@/components/usePoll";
import { instanceEvents, pollDue } from "@/lib/instance-events";
import type { ChatMessage } from "@/components/chat/types";
import type { DashboardShareMode } from "@/lib/backoffice";

const WIDE = "(min-width: 85rem)";

export interface DashboardData {
  available: boolean;
  modelFile?: string;
  title?: string;
  role?: string;
  reader?: string;
  kpis?: string[];
  lien?: string | null;
  hebergeur?: string;
  maj?: string | null;
  pdfPath?: string | null;
  htmlPath?: string | null;
  /** The PowerPoint the Expert made beside the PDF, when there is one. */
  pptxPath?: string | null;
  previewUrl?: string;
  isDjeneba?: boolean;
  teamViewLien?: string | null;
  /** False where the back office does not keep shares (sharing is then unavailable). */
  sharing?: boolean;
  share?: { mode: ShareMode; people: string[]; updatedAt: string | null } | null;
  candidates?: { email: string; name: string | null }[];
  shareUrl?: string | null;
}

export type ShareMode = DashboardShareMode;
type ShareAnswer = Pick<DashboardData, "share" | "candidates" | "shareUrl">;

interface DashboardContextValue {
  agentId: string;
  profile: string | null;
  agentName: string;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  openDashboard: (targetUrl?: string) => void;
  setCustomUrl: (url: string | null) => void;
  activeTab: "metier" | "equipe";
  setActiveTab: (tab: "metier" | "equipe") => void;
  data: DashboardData | null;
  loading: boolean;
  isGenerating: boolean;
  triggerGeneration: () => Promise<void>;
  activeUrl: string | null;
  embedUrl: string | null;
  copyShareLink: () => void;
  refresh: () => Promise<void>;
  shareModalOpen: boolean;
  setShareModalOpen: (open: boolean) => void;
  updateSharing: (mode: ShareMode, people?: string[], regenerate?: boolean) => Promise<boolean>;
  stopSharing: () => Promise<boolean>;
  downloadPdf: () => void;
  downloadHtml: () => void;
  downloadPptx: () => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useSafeDashboard() {
  return useContext(DashboardContext);
}

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used within DashboardProvider");
  return ctx;
}

/** A frame of the dashboard host (36-hex id, lib/dashboards), or one of this app's own models. */
export function isTrustedDashboardUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  if (url.startsWith("/modeles/")) return !url.includes("..") && !url.includes("//");
  return isTrustedFrameUrl(url);
}

/**
 * Extrait le dernier lien de tableau de bord ou frame partage dans l'historique des messages.
 */
export function extractDashboardLinkFromMessages(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m.content) continue;
    // 1. Liens Markdown
    const mdMatch = m.content.match(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/i);
    if (mdMatch && mdMatch[2] && isTrustedDashboardUrl(mdMatch[2])) {
      return mdMatch[2];
    }
    // 2. Liens directs pointant vers des frames sécurisés
    const bareMatch = m.content.match(/https?:\/\/[^\s\)\>\]"'`]+/i);
    if (bareMatch && isTrustedDashboardUrl(bareMatch[0])) {
      return bareMatch[0];
    }
  }
  return null;
}

export function DashboardProvider({
  agentId,
  profile,
  agentName,
  onTriggerTableau,
  isStreaming = false,
  messages = [],
  children,
}: {
  agentId: string;
  profile: string | null;
  agentName: string;
  onTriggerTableau?: () => void;
  isStreaming?: boolean;
  messages?: ChatMessage[];
  children: ReactNode;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"metier" | "equipe">("metier");
  const [data, setData] = useState<DashboardData | null>(null);
  const [customUrl, setCustomUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const lastRead = useRef(0);

  // `fresh`: after an instance event, the server's few-seconds reading is not reused.
  const fetchDashboard = useCallback(async (fresh = false) => {
    if (!agentId || !profile) {
      setData(null);
      return;
    }
    setLoading(true);
    lastRead.current = Date.now();
    try {
      const res = await apiFetch<DashboardData>(`/api/agents/${agentId}/experts/${encodeURIComponent(profile)}/dashboard${fresh ? "?fresh=1" : ""}`);
      setData(res);
    } catch (err) {
      console.warn("Erreur chargement dashboard:", err);
    } finally {
      setLoading(false);
    }
  }, [agentId, profile]);

  const openDashboard = useCallback((targetUrl?: string) => {
    if (targetUrl) {
      setCustomUrl(targetUrl);
    }
    if (typeof window !== "undefined" && window.matchMedia(WIDE).matches) {
      setPanelOpen(true);
    } else {
      setDialogOpen(true);
    }
  }, []);

  const triggerGeneration = useCallback(async () => {
    if (isGenerating || isStreaming) return;
    setIsGenerating(true);
    openDashboard();
    if (onTriggerTableau) {
      onTriggerTableau();
    }
  }, [isGenerating, isStreaming, openDashboard, onTriggerTableau]);

  // Pendant la génération, relu à chaque tour fini ou fichier écrit sur l'instance ; sans ce flux (ou en filet,
  // toutes les 30 s), toutes les 5 s (onglet visible), 10 min au plus, pour voir arriver le lien.
  usePoll(() => (pollDue(instanceEvents.connected(agentId), Date.now() - lastRead.current) ? fetchDashboard() : undefined), {
    everyMs: 5_000,
    deadlineMs: 10 * 60_000,
    immediate: false,
    enabled: isGenerating,
  });
  useEffect(() => {
    if (!isGenerating || !agentId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = instanceEvents.on(agentId, (type) => {
      if (type !== "turn.ended" && type !== "files.changed") return;
      clearTimeout(timer);
      timer = setTimeout(() => void fetchDashboard(true), 800);
    });
    return () => (clearTimeout(timer), off());
  }, [isGenerating, agentId, fetchDashboard]);

  // Detection automatique du lien depuis les messages du chat
  const messageUrl = useMemo(() => {
    if (!messages || messages.length === 0) return null;
    return extractDashboardLinkFromMessages(messages);
  }, [messages]);

  // URL publique active (pour affichage, lien externe, partage)
  const activeUrl = useMemo(() => {
    // Only a link the dashboard host serves (or one of our models) is ever framed or opened.
    const pick = (...urls: (string | null | undefined)[]) => urls.find(isTrustedDashboardUrl) ?? null;
    if (activeTab === "equipe" && data?.isDjeneba) {
      return pick(data.teamViewLien, customUrl, messageUrl);
    }
    return pick(customUrl, data?.lien, messageUrl);
  }, [customUrl, data, messageUrl, activeTab]);

  // URL pour l'integration dans l'iframe (securisee par sandbox strict sans allow-same-origin)
  const embedUrl = useMemo(() => {
    // No published link: the page the expert left in its drive, as the pack sends it without a host.
    if (!activeUrl) {
      return data?.htmlPath && agentId && profile && activeTab === "metier"
        ? `/api/dashboards/frame?agentId=${encodeURIComponent(agentId)}&profile=${encodeURIComponent(profile)}&path=${encodeURIComponent(data.htmlPath)}`
        : null;
    }
    if (isTrustedFrameUrl(activeUrl) && agentId && profile) {
      return `/api/dashboards/frame?agentId=${encodeURIComponent(agentId)}&profile=${encodeURIComponent(profile)}`;
    }
    return activeUrl;
  }, [activeUrl, agentId, profile, data?.htmlPath, activeTab]);

  // Quand le lien (ou la page dans le drive) arrive alors qu'on generait
  useEffect(() => {
    if (isGenerating && embedUrl) {
      setIsGenerating(false);
      toast.success(activeUrl ? "Le tableau de bord est mis en ligne." : "Le tableau de bord est prêt.");
    }
  }, [isGenerating, embedUrl, activeUrl]);

  // Si le streaming du chat se termine alors qu'on etait en attente
  useEffect(() => {
    if (isGenerating && !isStreaming) {
      const timer = setTimeout(() => {
        void fetchDashboard().finally(() => {
          setIsGenerating(false);
        });
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, isGenerating, fetchDashboard]);

  useEffect(() => {
    if (panelOpen || dialogOpen) {
      void fetchDashboard();
    }
  }, [panelOpen, dialogOpen, fetchDashboard]);

  // Si l'utilisateur change d'expert, fermer le panel et reinitialiser
  useEffect(() => {
    setPanelOpen(false);
    setDialogOpen(false);
    setShareModalOpen(false);
    setData(null);
    setCustomUrl(null);
    setIsGenerating(false);
    setActiveTab("metier");
  }, [profile]);

  const copyShareLink = useCallback(() => {
    if (!data?.shareUrl) {
      toast.error("Aucun lien de tableau de bord disponible.");
      return;
    }
    const fullUrl = `${window.location.origin}${data.shareUrl}`;

    navigator.clipboard.writeText(fullUrl);
    toast.success("Lien du tableau de bord copié.");
  }, [data?.shareUrl]);

  const sharePath = agentId && profile ? `/api/agents/${agentId}/experts/${encodeURIComponent(profile)}/dashboard` : null;

  const applyShare = useCallback(async (init: RequestInit): Promise<boolean> => {
    if (!sharePath) return false;
    try {
      const res = await apiFetch<ShareAnswer>(sharePath, init);
      setData((prev) => (prev ? { ...prev, share: res.share, candidates: res.candidates, shareUrl: res.shareUrl } : null));
      return true;
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Le partage n’a pas pu être enregistré.");
      return false;
    }
  }, [sharePath]);

  const updateSharing = useCallback(
    (mode: ShareMode, people: string[] = [], regenerate = false) =>
      applyShare({ method: "PATCH", body: JSON.stringify({ mode, people, regenerate }) }),
    [applyShare]
  );

  const stopSharing = useCallback(() => applyShare({ method: "DELETE" }), [applyShare]);

  const downloadPdf = useCallback(() => {
    if (data?.pdfPath) {
      const url = `/api/agents/${agentId}/files/content?path=${encodeURIComponent(data.pdfPath)}&disposition=attachment`;
      const a = document.createElement("a");
      a.href = url;
      a.download = data.pdfPath.split("/").pop() || `tableau-de-bord-${profile || "expert"}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("Téléchargement du PDF lancé.");
    } else {
      toast.info("Enregistrement en PDF…");
      window.print();
    }
  }, [agentId, data?.pdfPath, profile]);

  // The PowerPoint is a file the Expert writes with its PDF; without one, the Expert is asked for it.
  const downloadPptx = useCallback(() => {
    if (data?.pptxPath) {
      const a = document.createElement("a");
      a.href = `/api/agents/${agentId}/files/content?path=${encodeURIComponent(data.pptxPath)}&disposition=attachment`;
      a.download = data.pptxPath.split("/").pop() || `tableau-de-bord-${profile || "expert"}.pptx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("Téléchargement du PowerPoint lancé.");
    } else {
      toast.info("Pas encore de version PowerPoint : demandez-la à l’Expert dans la discussion.");
    }
  }, [agentId, data?.pptxPath, profile]);

  const downloadHtml = useCallback(async () => {
    if (data?.htmlPath) {
      const url = `/api/agents/${agentId}/files/content?path=${encodeURIComponent(data.htmlPath)}&disposition=attachment`;
      const a = document.createElement("a");
      a.href = url;
      a.download = data.htmlPath.split("/").pop() || `tableau-de-bord-${profile || "expert"}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("Téléchargement de la page HTML lancé.");
    } else if (embedUrl) {
      try {
        toast.info("Préparation du fichier HTML…");
        const res = await fetch(embedUrl);
        if (!res.ok) throw new Error("Erreur de recuperation");
        const html = await res.text();
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `tableau-de-bord-${profile || "expert"}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        toast.success("Fichier HTML téléchargé.");
      } catch {
        toast.error("Le fichier HTML n’a pas pu être téléchargé.");
      }
    } else {
      toast.error("Rien à télécharger pour l’instant.");
    }
  }, [agentId, data?.htmlPath, embedUrl, profile]);

  return (
    <DashboardContext.Provider
      value={{
        agentId,
        profile,
        agentName,
        panelOpen,
        setPanelOpen,
        dialogOpen,
        setDialogOpen,
        openDashboard,
        setCustomUrl,
        activeTab,
        setActiveTab,
        data,
        loading,
        isGenerating,
        triggerGeneration,
        activeUrl,
        embedUrl,
        copyShareLink,
        refresh: () => fetchDashboard(),
        shareModalOpen,
        setShareModalOpen,
        updateSharing,
        stopSharing,
        downloadPdf,
        downloadHtml,
        downloadPptx,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}
