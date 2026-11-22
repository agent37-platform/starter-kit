import {
  Calculator,
  Compass,
  Handshake,
  Headset,
  Layers,
  Megaphone,
  Package,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Expert } from "@/lib/types";

// The cycle an Expert belongs to, as one word beside its name (Leslie, 30/10: « le petit mot de chaque
// expert, c'est le nom du cycle »). The back office sends the cycle's own label (« Marketing
// événementiel »): it is read to one of the seven cycles Yelema sells, in the order of its offer,
// matched most specific first. Djénéba heads every cycle: « Direction ». Any other cycle keeps its
// label and comes after them, with a neutral stack.
const CYCLES: { re: RegExp; name: string; icon: LucideIcon }[] = [
  { re: /invest|portefeuille/, name: "Investissement", icon: TrendingUp },
  { re: /client|fid[eé]lisation/, name: "Service client", icon: Headset },
  { re: /commercial|vente/, name: "Commercial", icon: Handshake },
  { re: /marketing|communication/, name: "Marketing", icon: Megaphone },
  { re: /\brh\b|talent|ressources humaines/, name: "RH", icon: Users },
  { re: /financ|compta/, name: "Finance", icon: Calculator },
  { re: /op[eé]ration|logistique|achat|stock/, name: "Opérations", icon: Package },
];
// The order of the offer as Leslie reads it (02/11): selling, then serving the client, then running the house.
const ORDER = ["Commercial", "Marketing", "Service client", "RH", "Finance", "Opérations", "Investissement"];

// The catalogue as Yelema sells it (catalogue des Experts IA, 31/10/26): each Expert's cycle and place in
// it. It wins over the back office's own labels (« Ventes & Relation client », « Légal », « Direction »),
// which merge or split cycles and left Djénéba folded at the bottom (Leslie, 02/11). Djénéba is in none.
const CATALOGUE: Record<string, [cycle: string, place: number]> = Object.fromEntries(
  (
    [
      ["Commercial", ["kouassi", "sena", "aminata", "seydou"]],
      ["Marketing", ["fatima", "koffi", "aya", "yao"]],
      ["RH", ["fatou", "adjoua", "lamine", "cheikh"]],
      ["Finance", ["mamadou", "kadiatou", "daouda", "rokia"]],
      ["Service client", ["awa", "akissi", "ousmane", "malick"]],
      // Ali a remplacé Yacouba au catalogue (09/11) ; Yacouba reste pour les comptes qui l'ont déjà.
      ["Opérations", ["salif", "ali", "sidiki", "assita", "yacouba"]],
      ["Investissement", ["alioune", "fifame", "ibrahim", "aicha"]],
    ] as const
  ).flatMap(([cycle, names]) => names.map((n, i) => [n, [cycle, i]] as const))
);

// A cycle's name in the menu when it is not the one word above: « Ressources Humaines », never the back
// office's own labels (« Opérations & Données »…) (Leslie, 02/11).
const LABELS: Record<string, string> = { RH: "Ressources Humaines" };

// Each Expert's job in a few words, as the catalogue says it (dépôt hermes-experts, Leslie 02/11): it wins over
// the back office's longer titles under the name in the menu.
const JOBS: Record<string, string> = {
  djeneba: "Chief of Staff & Direction",
  kouassi: "Commercial et ventes", sena: "Offres et signature", aminata: "Pilotage commercial", seydou: "Veille commerciale",
  fatima: "Marketing et contenu", koffi: "Design de marque", aya: "Influence et créateurs", yao: "Veille et rapports marketing",
  fatou: "Ressources humaines et paie", adjoua: "Recrutement", lamine: "Développement des personnes", cheikh: "Climat social et lieux de travail",
  mamadou: "Comptable général", kadiatou: "Comptable fournisseurs", daouda: "Comptable clients", rokia: "Contrôleuse de gestion",
  awa: "Support et relation client", akissi: "Satisfaction et fidélisation", ousmane: "Qualité du service client", malick: "Après-vente",
  salif: "Opérations", ali: "Achats et import", yacouba: "Achats et import", sidiki: "Livraisons et flotte", assita: "Production, qualité et sécurité",
  alioune: "Investissement", fifame: "Sourcing d’investissement", ibrahim: "Juridique", aicha: "Portefeuille",
};

const plain = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** The catalogue's entry for an Expert (« unifood__adjoua », « adjoua-v72 »…), or null. */
function catalogueEntry(e: { catalogueKey?: string | null; profileId: string }): [string, number] | null {
  for (const id of [e.catalogueKey, e.profileId]) {
    const hit = id && plain(id).split(/[^a-z]+/).find((w) => w in CATALOGUE);
    if (hit) return CATALOGUE[hit];
  }
  return null;
}

/** The Expert's job under its name: the catalogue's, else the back office's title. */
export function catalogueJob(e: { catalogueKey?: string | null; profileId: string }, fallback: string | null): string | null {
  for (const id of [e.catalogueKey, e.profileId]) {
    const hit = id && plain(id).split(/[^a-z]+/).find((w) => w in JOBS);
    if (hit) return JOBS[hit];
  }
  return fallback;
}

/** The cycle shown for an Expert: the catalogue's first, then the back office's; none for Djénéba. */
export function catalogueCycle(
  e: { catalogueKey?: string | null; profileId: string },
  fallback: { key: string; label: string } | null
): { key: string; label: string } | null {
  if (isDjeneba(e)) return null;
  const hit = catalogueEntry(e);
  // An Expert the catalogue does not list goes under the cycle its back-office label names (« Ventes & Relation
  // client » is « Service client »), so that one cycle never shows twice under two names.
  const name = hit?.[0] ?? (fallback && CYCLES.find((c) => c.re.test(fallback.label.toLowerCase()))?.name);
  return name ? { key: plain(name).replace(/\s+/g, "-"), label: LABELS[name] ?? name } : fallback;
}

/** Where an Expert sits in the menu: Djénéba first, then by cycle and place in the catalogue. */
export function expertRank(e: Pick<Expert, "profileId" | "catalogueKey" | "cycle">): number {
  if (isDjeneba(e)) return -1;
  const hit = catalogueEntry(e);
  if (hit) return ORDER.indexOf(hit[0]) * 100 + hit[1];
  return e.cycle ? cycleKind(e.cycle.label).rank * 100 + 99 : 10_000;
}

export const isDjeneba = (e: { catalogueKey?: string | null; profileId: string }) =>
  (e.catalogueKey ?? e.profileId).toLowerCase().includes("djeneba");

/** One of the seven cycles for a back-office label, or the label itself. */
export function cycleKind(label: string): { name: string; icon: LucideIcon; rank: number } {
  const l = label.toLowerCase();
  const k = CYCLES.find((c) => c.re.test(l));
  return k ? { name: k.name, icon: k.icon, rank: ORDER.indexOf(k.name) } : { name: label, icon: Layers, rank: ORDER.length };
}

/** « Direction » for Djénéba, the cycle's name for the others, nothing when the back office says none. */
export function expertCycle(e: Pick<Expert, "profileId" | "catalogueKey" | "cycle">): { name: string; icon: LucideIcon } | null {
  if (isDjeneba(e)) return { name: "Direction", icon: Compass };
  return e.cycle ? cycleKind(e.cycle.label) : null;
}
