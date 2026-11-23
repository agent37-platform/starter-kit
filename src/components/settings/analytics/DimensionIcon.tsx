"use client";

import {
  Activity,
  BookOpen,
  Clock,
  Code2,
  Cpu,
  File,
  FileSpreadsheet,
  FileText,
  GitBranch,
  Image as ImageIcon,
  Mail,
  MessageSquare,
  Music,
  Plug,
  Presentation,
  Send,
  Server,
  Terminal,
  Video,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { ExpertImage } from "@/components/experts/ExpertImage";
import type { AnalyticsItem } from "@/lib/analytics/types";
import { SESSION_SOURCES as S } from "@/lib/yele-mcp/hermes-layout";

// Icône d'une ligne : son logo s'il en a un, l'initiale d'un expert dans sa couleur, sinon l'icône de
// son `iconKind`.
const ICONS: Record<string, LucideIcon> = {
  [S.app]: MessageSquare,
  [S.routine]: Clock,
  [S.telegram]: Send,
  [S.email]: Mail,
  [S.oneShot]: Zap,
  [S.subagent]: GitBranch,
  [S.editor]: Code2,
  [S.cli]: Terminal,
  model: Cpu,
  skill: BookOpen,
  mcp: Server,
  connector: Plug,
  excel: FileSpreadsheet,
  word: FileText,
  pdf: FileText,
  powerpoint: Presentation,
  image: ImageIcon,
  video: Video,
  audio: Music,
  other: File,
};

const BOX = "flex size-7 shrink-0 items-center justify-center rounded-lg bg-soft text-ink-2 ring-1 ring-line";

export function DimensionIcon({ item, color, photo }: { item: AnalyticsItem; color?: string; photo?: string | null }) {
  if (item.logo) {
    return (
      <span className={BOX}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.logo} alt="" className="size-4 object-contain" loading="lazy" />
      </span>
    );
  }
  if (item.iconKind === "expert" && photo?.startsWith("/yele/")) {
    // Yélé : l'astérisque au visage, entier sur fond clair, comme dans un appel.
    return (
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-tint">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo} alt="" width={64} height={64} className="size-[78%] object-contain" loading="lazy" />
      </span>
    );
  }
  if (item.iconKind === "expert") {
    return (
      // Le visage de l'Expert en version légère (48 px, celle du menu, déjà en cache) ; l'initiale
      // dans sa couleur attend dessous et reste si la photo manque.
      <span className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold text-white" style={{ backgroundColor: color }}>
        {item.name.charAt(0).toUpperCase()}
        {photo && <ExpertImage src={photo} size={48} className="absolute inset-0 size-full rounded-full object-cover object-[50%_20%]" />}
      </span>
    );
  }
  const Icon = ICONS[item.iconKind] ?? Activity;
  return (
    <span className={BOX}>
      <Icon className="size-3.5" />
    </span>
  );
}
