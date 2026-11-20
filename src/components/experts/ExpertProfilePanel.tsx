"use client";

import "./expert-panel.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgeCheck, BarChart3, Copy, CreditCard, LayoutDashboard, Mail, Monitor, PanelRight, Phone, RefreshCw, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { driveTree, onDriveChanged } from "@/lib/drive-store";
import { fileLabel } from "@/lib/drive-paths";
import { cardLines, fileKind, hiredOn, lastDeliverables, shareCardText, shortWhen, type PanelFile } from "@/lib/expert-card";
import type { CallRecord } from "@/lib/voice";
import { cn } from "@/lib/utils";
import { setProfilePanel, setProfilePanelHere, useProfilePanel } from "@/components/chat/chat-layout";
import { useComputer } from "@/components/experts/ComputerProvider";
import { useDashboard } from "@/components/experts/DashboardProvider";
import { useToggleDashboard } from "@/components/experts/ExpertDashboard";
import { ExpertReadiness } from "@/components/experts/ExpertReadiness";
import { CallButton } from "@/components/voice/CallButton";
import { FilePreview } from "@/components/files/FilePreview";
import type { FileEntry } from "@/components/files/types";

// « Profil de l'Expert » beside its chat (Team design export, 18/11; Myriel's choice A, Leslie): the header
// above keeps Appeler and « … », so the page works with the panel open or closed. Closed at first, then as
// the member left it. On a wide screen it sits beside the chat and folds the conversations away; narrower,
// it slides over the chat. One panel at a time: opening it closes Son ordinateur and Tableau de bord.

const WIDE = "(min-width: 85rem)";

export interface ProfilePanelExpert {
  agentId: string;
  profileId: string;
  name: string;
  role: string | null;
  photoUrl: string | null;
  /** The catalogue's key: calls and the card's number. */
  key: string | null;
  email: string | null;
  company: string | null;
  /** The cycle or the catalogue's category it belongs to (« Direction »). */
  team: string | null;
  /** « Embauché le » : its arrival on the instance (ISO 8601), null when unknown. */
  since: string | null;
  /** Its folder in the drive (`~/Livrables/<dossier>`). */
  folder: string;
  hasComputer: boolean;
  /** Calls exist for it (voice on, an expert of the catalogue). */
  calls: boolean;
}

/** The button at the right end of the chat bar, on the side the panel opens, that opens and closes it. */
export function ProfilePanelToggle() {
  const open = useProfilePanel();
  return (
    <button
      type="button"
      onClick={() => setProfilePanel(!open)}
      aria-pressed={open}
      aria-label={open ? "Fermer le profil de l’Expert" : "Profil de l’Expert"}
      title="Profil de l’Expert"
      className={cn("grid size-9 shrink-0 place-items-center rounded-full", open ? "bg-tint text-brand-ink" : "text-ink-2 hover:bg-soft hover:text-ink")}
    >
      <PanelRight className="h-5 w-5" />
    </button>
  );
}

export function ExpertProfilePanel({
  expert,
  onTab,
  onOpenCall,
}: {
  expert: ProfilePanelExpert;
  /** « Tout voir » of Livrables or Appels: that tab. */
  onTab: (tab: "files" | "calls") => void;
  onOpenCall: (id: string) => void;
}) {
  const router = useRouter();
  const open = useProfilePanel();
  const dash = useDashboard();
  const toggleDashboard = useToggleDashboard();
  const comp = useComputer();
  const [flipped, setFlipped] = useState(false);
  const [card, setCard] = useState(false);
  const [files, setFiles] = useState<PanelFile[] | null>(null);
  const [calls, setCalls] = useState<CallRecord[] | null>(null);
  const [preview, setPreview] = useState<FileEntry | null>(null);

  // Only this page has the panel: an open one folds the conversations here, nowhere else.
  useEffect(() => {
    setProfilePanelHere(true);
    return () => setProfilePanelHere(false);
  }, []);

  // Open beside the chat, Yélé's bubble moves left of it (expert-panel.css).
  useEffect(() => {
    if (!open) return;
    document.body.dataset.profilePanel = "1";
    return () => {
      delete document.body.dataset.profilePanel;
    };
  }, [open]);

  // One panel beside the chat at a time.
  const dashOpen = dash.panelOpen;
  const compOpen = Boolean(comp?.panelOpen);
  const before = useRef({ dashOpen, compOpen, open });
  useEffect(() => {
    const was = before.current;
    if ((dashOpen && !was.dashOpen) || (compOpen && !was.compOpen)) setProfilePanel(false);
    else if (open && !was.open) {
      if (dashOpen) dash.setPanelOpen(false);
      if (compOpen) comp?.setPanelOpen(false);
    }
    before.current = { dashOpen, compOpen, open };
  }, [dashOpen, compOpen, open, dash, comp]);

  // Échap closes the card, then the panel where it covers the chat.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (card) setCard(false);
      else if (!window.matchMedia(WIDE).matches) setProfilePanel(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, card]);

  // Its last deliverables, read again when the drive changes.
  const readFiles = useCallback(() => {
    driveTree(expert.agentId).then(
      (t) => setFiles(lastDeliverables(t.entries, expert.folder)),
      () => setFiles((prev) => prev ?? [])
    );
  }, [expert.agentId, expert.folder]);
  useEffect(() => {
    if (!open) return;
    readFiles();
    return onDriveChanged(expert.agentId, readFiles);
  }, [open, readFiles, expert.agentId]);

  // Its last calls.
  useEffect(() => {
    if (!open || !expert.calls || !expert.key) return;
    let live = true;
    apiFetch<{ items: CallRecord[] }>(`/api/voice/calls?expert=${encodeURIComponent(expert.key)}`).then(
      (r) => live && setCalls(r.items.filter((c) => c.status !== "failed").slice(0, 3)),
      () => live && setCalls((prev) => prev ?? [])
    );
    return () => {
      live = false;
    };
  }, [open, expert.calls, expert.key]);

  if (!open) return null;

  const copy = (text: string, done: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast.success(done),
      () => toast.error("La copie n’a pas pu se faire.")
    );
  const share = async () => {
    const text = shareCardText({ name: expert.name, role: expert.role, company: expert.company, email: expert.email });
    if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title: expert.name, text });
        return;
      } catch {
        // Partage annulé : rien à dire.
        return;
      }
    }
    copy(text, "Carte copiée : vous pouvez la coller où vous voulez.");
  };
  // Son ordinateur and Tableau de bord take the panel's place (beside the chat, or full screen on a phone).
  const openComputer = () => {
    if (!comp) return;
    setProfilePanel(false);
    if (window.matchMedia(WIDE).matches) comp.setPanelOpen(true);
    else comp.setDialogOpen(true);
  };
  const openDashboard = () => {
    setProfilePanel(false);
    if (!dash.panelOpen) toggleDashboard();
  };
  const callee = expert.key ? { key: expert.key, name: expert.name, photoUrl: expert.photoUrl } : null;
  const lines = cardLines({ name: expert.name, company: expert.company, team: expert.team, role: expert.role, key: expert.key ?? expert.profileId });
  const theCard = <ExpertCard expert={expert} lines={lines} />;

  return (
    <>
      {/* Narrower than a wide screen it covers the chat: a veil closes it. */}
      <div aria-hidden className="fixed inset-0 z-50 bg-ink/35 wide:hidden" onClick={() => setProfilePanel(false)} />
      <aside
        aria-label="Profil de l’Expert"
        className="fixed inset-y-0 right-0 z-50 flex w-[min(380px,100vw)] flex-col border-l border-line bg-surface shadow-[-12px_0_40px_rgb(48_22_103/0.18)] wide:static wide:z-auto wide:w-[360px] wide:shrink-0 wide:shadow-none"
      >
        <div className="yp-top">
          <b>Profil de l’Expert</b>
          <button type="button" className="yp-ib" onClick={() => setProfilePanel(false)} aria-label="Fermer le panneau" title="Fermer">
            <X className="yp-i" />
          </button>
        </div>
        <div className="yp-body">
          <div className="yp-id">
            <button
              type="button"
              className={cn("yp-flip", flipped && "is-card")}
              onClick={() => setFlipped(!flipped)}
              aria-label={flipped ? "Revoir la photo" : "Retourner pour voir la carte de visite"}
              title={flipped ? "Revoir la photo" : "Voir la carte de visite"}
            >
              <span className="yp-in">
                <span className="yp-f yp-front">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {expert.photoUrl ? <img src={expert.photoUrl} alt={expert.name} /> : <span className="grid h-full place-items-center bg-tint font-display text-4xl font-bold text-brand-ink">{expert.name.charAt(0)}</span>}
                </span>
                <span className="yp-f yp-back">{theCard}</span>
              </span>
              <span className="yp-fb">
                <RefreshCw className="yp-i" />
              </span>
            </button>
            <div className="yp-name">{expert.name}</div>
            {expert.role && <div className="yp-role">{expert.role}</div>}
            <ExpertReadiness variant="dot" agentId={expert.agentId} profileId={expert.profileId} expertName={expert.name} onOpenTools={() => router.push("/integrations/connecteurs")} className="mt-1 text-[12px]" />
            {expert.email && (
              <button type="button" className="yp-mail" onClick={() => copy(expert.email!, "Adresse e-mail copiée.")} title="Copier l’adresse e-mail">
                <Mail className="yp-i" />
                <span>{expert.email}</span>
                <Copy className="yp-i" />
              </button>
            )}
          </div>

          {callee && <CallButton expert={callee} className="yp-call" />}

          <div className="yp-tiles">
            <button type="button" className="yp-t" onClick={openDashboard}>
              <span className="b"><LayoutDashboard className="yp-i" /></span>
              <span><b className="l">Tableau de bord</b><small>Vue d’ensemble</small></span>
            </button>
            <button type="button" className="yp-t c2" onClick={() => router.push(`/parametres/analytics?experts=${encodeURIComponent(expert.profileId)}`)}>
              <span className="b"><BarChart3 className="yp-i" /></span>
              <span><b className="l">Analytics</b><small>Usage et résultats</small></span>
            </button>
            {expert.hasComputer && (
              <button type="button" className="yp-t c3" onClick={openComputer}>
                <span className="b"><Monitor className="yp-i" /></span>
                <span><b className="l">Ordinateur</b><small>Son poste de travail</small></span>
              </button>
            )}
            <button type="button" className="yp-t c4" onClick={() => setCard(true)}>
              <span className="b"><CreditCard className="yp-i" /></span>
              <span><b className="l">Carte de visite</b><small>Voir et partager</small></span>
            </button>
          </div>

          <section>
            <div className="yp-h">
              <h3>Livrables{files && files.length > 0 && <span> · {files.length} derniers</span>}</h3>
              <button type="button" onClick={() => onTab("files")}>Tout voir</button>
            </div>
            {files === null ? (
              <div className="yp-dl">{[0, 1].map((i) => <span key={i} className="yp-th animate-pulse rounded-[var(--radius-lg)]" />)}</div>
            ) : files.length === 0 ? (
              <p className="text-[12.5px] text-ink-3">Pas encore de livrable.</p>
            ) : (
              <div className="yp-dl">
                {files.map((f) => (
                  <button key={f.path} type="button" className="yp-d" onClick={() => setPreview({ name: f.name, path: f.path, type: "file", size: 0, modified: f.modified, hidden: false })}>
                    <span className="yp-th place-items-center text-[11px] font-bold uppercase tracking-wide text-brand-ink/70" style={{ display: "grid" }}>{fileKind(f.name)}</span>
                    <div>
                      <b title={fileLabel(f)}>{fileLabel(f).replace(/\.[^.]+$/, "")}</b>
                      <small>{[fileKind(f.name), shortWhen(f.modified)].filter(Boolean).join(" · ")}</small>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          {expert.calls && (
            <section>
              <div className="yp-h">
                <h3>Appels{calls && calls.length > 0 && <span> · {calls.length} récents</span>}</h3>
                <button type="button" onClick={() => onTab("calls")}>Tout voir</button>
              </div>
              {calls === null ? null : calls.length === 0 ? (
                <p className="text-[12.5px] text-ink-3">Pas encore d’appel.</p>
              ) : (
                <div className="yp-calls">
                  {calls.map((c) => (
                    <button key={c.id} type="button" className="yp-c" onClick={() => onOpenCall(c.id)}>
                      <span className="b"><Phone className="yp-i" /></span>
                      <span className="t">
                        <b>{c.subject ?? "Appel"}</b>
                        <small>{callWhen(c.startedAt)}</small>
                      </span>
                      {c.durationSeconds ? <em>{Math.max(1, Math.round(c.durationSeconds / 60))} min</em> : null}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </aside>

      {card && (
        <div className="yp-modal on" role="dialog" aria-modal="true" aria-label="Carte de visite" onClick={(e) => e.target === e.currentTarget && setCard(false)}>
          <div className="m">
            <h4>
              Carte de visite
              <button type="button" className="yp-ib" onClick={() => setCard(false)} aria-label="Fermer">
                <X className="yp-i" />
              </button>
            </h4>
            {theCard}
            <div className="yp-mact">
              {expert.email && (
                <button type="button" onClick={() => copy(expert.email!, "Adresse e-mail copiée.")}>
                  Copier l’e-mail
                </button>
              )}
              <button type="button" className="p" onClick={() => void share()}>
                Partager
              </button>
            </div>
          </div>
        </div>
      )}
      <FilePreview agentId={expert.agentId} entry={preview} onClose={() => setPreview(null)} />
    </>
  );
}

function callWhen(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const day = shortWhen(d.getTime());
  return day === "aujourd’hui" ? `Aujourd’hui, ${time}` : day === "hier" ? `Hier, ${time}` : day;
}

/** The expert's card, the size of its parent (Team design's « Carte d'Expert », without the hiring date: none is served). */
function ExpertCard({ expert, lines }: { expert: ProfilePanelExpert; lines: string[] }) {
  const field = (label: string, value: string | null, big = false) =>
    value ? (
      <span className="yc-f">
        <small>{label}</small>
        <b className={big ? "big" : undefined}>{value.toUpperCase()}</b>
      </span>
    ) : null;
  return (
    <span className="yc" aria-label="Carte d’Expert Yelema">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="yc-wave" src="/experts/carte-ondes.svg" alt="" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="yc-wm" src="/experts/carte-rosace.svg" alt="" />
      <span className="yc-hd">
        <span className="yc-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/yelema_y_violet.svg" alt="" />
          <span>
            <small>Yelema</small>
            <b>Carte d’Expert</b>
          </span>
        </span>
        <span className="yc-ok">
          <BadgeCheck />
          Expert Yelema vérifié
        </span>
      </span>
      <span className="yc-bd">
        <span className="yc-ph">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {expert.photoUrl && <img src={expert.photoUrl} alt="" />}
        </span>
        <span className="yc-fl">
          {field("Prénom", expert.name, true)}
          <span className="yc-g">
            {field("Organisation", expert.company)}
            {field("Équipe", expert.team)}
            {field("Spécialité", expert.role)}
            {field("Embauché le", hiredOn(expert.since))}
          </span>
        </span>
      </span>
      <span className="yc-mz">
        <span className="yc-mt">
          {lines.map((l, i) => (
            <span key={i} className="yc-ml">
              {[...l].map((c, j) => (
                <i key={j}>{c}</i>
              ))}
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}
