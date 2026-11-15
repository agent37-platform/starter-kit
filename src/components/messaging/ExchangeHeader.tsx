"use client";

import { ArrowLeft, Hash, MessagesSquare, User, UserPlus, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/app/NotificationBell";

// La bande du haut d'Échanges, comme celle d'un Expert : à gauche ce qui est ouvert (Échanges › son nom), puis
// les onglets soulignés (Discussion, et pour un salon Livrables et Participants), à droite « Ajouter ».

export type ExchangePane = "fil" | "livrables" | "participants";

export interface HeaderProps {
  title: string | null;
  kind: "unite" | "salon" | "direct" | null;
  pane: ExchangePane;
  canAdd: boolean;
  onPane: (p: ExchangePane) => void;
  onBack: () => void;
  onAdd: () => void;
}

export function ExchangeHeader(p: HeaderProps) {
  const tabs: { id: ExchangePane; label: string }[] = p.kind === "unite" || p.kind === "salon" ? [{ id: "fil", label: "Discussion" }, { id: "livrables", label: "Livrables" }, { id: "participants", label: "Participants" }] : p.kind ? [{ id: "fil", label: "Discussion" }] : [];
  const Icon = p.kind === "unite" ? Users : p.kind === "salon" ? Hash : p.kind === "direct" ? User : MessagesSquare;
  return (
    <div className="shrink-0 border-b border-line bg-surface">
      <div className="flex flex-wrap items-center lg:h-16 lg:flex-nowrap lg:gap-5 lg:px-6">
        <div className="order-1 flex min-w-0 flex-1 items-center gap-2.5 px-4 pb-1 pt-2.5 lg:w-[272px] lg:flex-none lg:p-0">
          {p.title && (
            <button type="button" onClick={p.onBack} aria-label="Retour aux échanges" className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-soft lg:hidden">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl lg:size-10", p.kind === "direct" ? "bg-soft-2 text-ink-2" : "bg-tint text-brand")}>
            <Icon className="h-4 w-4 lg:h-5 lg:w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-3 lg:text-[12.5px]">
              <button type="button" onClick={p.onBack} className="shrink-0 hover:text-ink">Échanges</button>
              {p.title && <span aria-hidden>›</span>}
              {p.title && <span className="truncate">{p.kind === "unite" ? "Salon d’équipe" : p.kind === "salon" ? "Salon" : "Direct"}</span>}
            </span>
            <span className="block truncate font-display text-sm font-bold leading-tight text-ink lg:text-[17px]">{p.title ?? "Vos échanges"}</span>
          </span>
        </div>
        {tabs.length > 0 && (
          <nav className="order-3 flex w-full items-center gap-0.5 overflow-x-auto px-2.5 py-2 sm:gap-1 sm:px-4 [scrollbar-width:none] lg:order-2 lg:h-full lg:w-auto lg:min-w-0 lg:flex-1 lg:gap-5 lg:p-0 [&::-webkit-scrollbar]:hidden">
            {tabs.map((t) => {
              const on = p.pane === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => p.onPane(t.id)}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "min-h-9 shrink-0 rounded-full px-2 py-1.5 text-[13px] font-semibold sm:px-3 lg:-mb-px lg:inline-flex lg:h-full lg:items-center lg:rounded-none lg:border-b-2 lg:px-0.5 lg:text-[15px]",
                    on ? "bg-tint text-brand-ink lg:border-brand lg:bg-transparent" : "text-ink-2 hover:bg-soft lg:border-transparent lg:hover:bg-transparent lg:hover:text-ink",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>
        )}
        <div className="order-2 flex shrink-0 items-center gap-2 pr-4 pt-1.5 lg:order-3 lg:ml-auto lg:p-0">
          {p.canAdd && (
            <Button variant="outline" size="sm" onClick={p.onAdd}>
              <UserPlus /> Ajouter
            </Button>
          )}
          {/* La barre du haut est masquée sur ordinateur (comme pour un Expert) : la cloche vient ici. */}
          <span className="max-lg:hidden">
            <NotificationBell />
          </span>
        </div>
      </div>
    </div>
  );
}
