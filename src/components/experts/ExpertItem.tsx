import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useNotifications } from "@/components/activity/ActivityProvider";
import { useExpertActivity } from "@/components/activity/hooks";
import { ExpertAvatar } from "@/components/experts/ExpertAvatar";
import { agentTabPath } from "@/lib/expert-tabs";
import { expertCycle, isDjeneba } from "@/lib/expert-cycle";
import { preloadExpert, preloadSpace } from "@/components/experts/expert-preload";
import { sparingData, useInView, useIntent } from "@/components/usePrefetch";
import { setChatListHidden } from "@/components/chat/chat-layout";
import type { Expert } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useInstallPending } from "./useInstallPending";

/**
 * Une ligne d'Expert. Unité partagée : barre latérale, accueil, et tout écran qui en liste.
 *
 * Le sous-titre suit ce qu'on sait : le métier que donne le catalogue, sinon le nom de l'instance.
 *
 * `compact` n'affiche que le visage (menu replié).
 *
 * Avec une réponse non lue, un clic ouvre directement la conversation la plus récente qui l'attend,
 * pas le dernier fil ouvert : un clic au lieu de deux.
 */
export function ExpertItem({
  expert,
  active = false,
  compact = false,
  className,
  onNavigate,
  readAhead = false,
  showCycle = false,
}: {
  /** Its cycle beside the name, where no cycle heading says it already (never for Djénéba). */
  showCycle?: boolean;
  expert: Expert;
  /** One of the first rows of the menu: its whole page is fetched ahead, code included. */
  readAhead?: boolean;
  active?: boolean;
  compact?: boolean;
  className?: string;
  onNavigate?: () => void;
}) {
  // Never the profile or instance id: a member has no use for either.
  const subtitle = expert.title ?? expert.role ?? expert.agentName ?? "";
  const { running, unread, waiting } = useExpertActivity(expert.agentId, expert.profileId);
  const bell = useNotifications();
  const toInstall = useInstallPending(expert);
  // Not for Djénéba: « Chief of Staff & Direction » under her name says it already (Leslie, 03/11).
  const cycle = showCycle && !compact && !isDjeneba(expert) ? expertCycle(expert) : null;
  // On its way (a pointer resting, a finger, the focus): its whole page; on screen: its conversations.
  const intent = useIntent(() => void preloadExpert(expert.agentId, expert.profileId, expert.catalogueKey));
  const inView = useInView<HTMLAnchorElement>(() => preloadSpace(expert.agentId, expert.profileId));
  const hint = unread ? (unread === 1 ? "1 nouvelle réponse" : `${unread} nouvelles réponses`) : running ? "En cours" : toInstall ? "À installer" : null;
  // Menu replié : au survol ou au focus, une étiquette à droite du visage avec le prénom et le poste
  // (Leslie, 22/11). Posée dans <body> : la colonne du menu défile et couperait une étiquette dedans.
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const showTip = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setTip({ x: r.right + 12, y: r.top + r.height / 2 });
  };

  return (
    <Link
      prefetch={readAhead && !(typeof navigator !== "undefined" && sparingData()) ? true : undefined}
      href={
        waiting
          ? `${agentTabPath(expert.agentId, "chat", expert.profileId)}?session=${encodeURIComponent(waiting.sessionId)}`
          : agentTabPath(expert.agentId, "chat", expert.profileId)
      }
      onClick={(e) => {
        onNavigate?.();
        // A new answer waits: the column of conversations comes back to show it (Leslie, 04/11).
        if (unread > 0) setChatListHidden(false);
        if (!waiting || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        bell.open(waiting);
      }}
      ref={inView}
      {...intent}
      onPointerEnter={(e) => {
        intent.onPointerEnter();
        if (compact) showTip(e.currentTarget);
      }}
      onPointerLeave={() => {
        intent.onPointerLeave();
        setTip(null);
      }}
      onFocus={(e) => {
        intent.onFocus();
        if (compact) showTip(e.currentTarget);
      }}
      onBlur={() => setTip(null)}
      aria-label={compact ? [expert.displayName, subtitle, hint].filter(Boolean).join(", ") : undefined}
      title={compact ? undefined : hint ? `${expert.displayName} · ${hint}` : expert.displayName}
      className={cn(
        "flex min-h-12 items-center gap-2.5 rounded-[11px] px-2 text-sm font-semibold transition-colors",
        active ? (compact ? "text-ink" : "bg-soft-2 text-ink") : "text-ink-2 hover:bg-soft",
        // Folded menu: the open Expert keeps the size of the others, a ring says it is the one (Leslie, 03/11).
        compact && "size-11 min-h-0 shrink-0 justify-center rounded-full px-0",
        className
      )}
    >
      <span className={cn("relative shrink-0 rounded-full", compact && active && "ring-2 ring-brand ring-offset-2 ring-offset-surface")}>
        <ExpertAvatar expert={expert} />
        {/* At work: a green dot that breathes; a new answer: the violet dot; nothing: no dot. */}
        {compact && (unread > 0 || running || toInstall) && (
          <span className={cn("absolute -right-0.5 -top-0.5 size-3 rounded-full ring-2 ring-surface", unread || (toInstall && !running) ? "bg-brand" : "animate-pulse bg-ok")} aria-hidden />
        )}
      </span>
      {!compact && (
        <span className="min-w-0 grow">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{expert.displayName}</span>
            {cycle && <CyclePill name={cycle.name} />}
          </span>
          <small className="block truncate text-xs font-medium text-ink-3">{subtitle}</small>
        </span>
      )}
      {!compact && unread > 0 && (
        <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-on-brand" aria-label={hint ?? undefined}>
          {unread}
        </span>
      )}
      {!compact && !unread && running && <Loader2 className="size-4 shrink-0 animate-spin text-ok" aria-label="En cours" />}
      {/* Its installation is still to do: a « 1 », as for one answer waiting (Leslie, 23/11). */}
      {!compact && !unread && !running && toInstall && (
        <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-on-brand" aria-label="À installer">
          1
        </span>
      )}
      {compact &&
        tip &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-50 max-w-64 -translate-y-1/2 rounded-xl bg-card px-3 py-2 shadow-lg ring-1 ring-line"
            style={{ left: tip.x, top: tip.y }}
          >
            <span className="absolute top-1/2 -left-1 size-2 -translate-y-1/2 rotate-45 bg-card ring-1 ring-line [clip-path:polygon(0_0,0_100%,100%_100%)]" aria-hidden />
            <span className="block text-sm font-semibold text-ink">{expert.displayName}</span>
            {subtitle && <span className="block text-xs font-medium text-ink-3">{subtitle}</span>}
            {hint && <span className={cn("mt-1 block text-xs font-semibold", unread || (toInstall && !running) ? "text-brand-ink" : "text-ok")}>{hint}</span>}
          </span>,
          document.body
        )}
    </Link>
  );
}

/** The cycle as one quiet word beside a name (Leslie, 30/10). */
export function CyclePill({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("shrink-0 rounded-full bg-tint px-2 py-0.5 text-[11px] font-semibold leading-4 text-brand-ink", className)}>{name}</span>
  );
}
