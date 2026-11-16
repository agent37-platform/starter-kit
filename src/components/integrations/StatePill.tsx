import { cn } from "@/lib/utils";

// The one state pill of Connecteurs and Canaux, same size everywhere (Leslie, 05/11: « les boutons n'ont pas
// la même taille »): « Connecter » to set up, « Connecté » on a pale green, « À reconnecter » / « À vérifier »
// on a pale coral. It is a label inside a card or row that is itself the button.
export type PillState = "connect" | "connected" | "attention" | "soon";

const TONE: Record<PillState, string> = {
  connect: "border border-line bg-surface text-ink",
  connected: "bg-ok-pale text-ok",
  attention: "bg-coral-pale text-coral-ink",
  soon: "bg-soft text-ink-3",
};

export function StatePill({ state, label, className }: { state: PillState; label?: string; className?: string }) {
  const text = label ?? (state === "connect" ? "Connecter" : state === "connected" ? "Connecté" : state === "soon" ? "Bientôt" : "À vérifier");
  return (
    <span className={cn("inline-flex h-8 min-w-[108px] shrink-0 items-center justify-center rounded-full px-3 text-[13px] font-semibold", TONE[state], className)}>
      {text}
    </span>
  );
}
