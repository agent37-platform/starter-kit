import { BarChart3, Bell, Building2, CreditCard, Gauge, Mic, Network, Palette, Server, Settings, UserRound, Users, type LucideIcon } from "lucide-react";

export interface SettingsEntry {
  href: string;
  label: string;
  icon: LucideIcon;
  // Admins only; Entreprise is for everyone (a member reads its memory).
  adminOnly?: boolean;
  // Served by the back office: shown only where the app signs in through it.
  backoffice?: boolean;
}

// Paramètres, as in ChatGPT (Leslie, 24/10, option B): what is mine, for everyone, then what is the
// company's, for its admin. It replaces Administration; Intégrations stays apart in the menu.
export const SETTINGS_GROUPS: { label: string; entries: SettingsEntry[] }[] = [
  {
    label: "Personnel",
    entries: [
      { href: "/parametres", label: "Général", icon: Settings },
      { href: "/parametres/apparence", label: "Apparence", icon: Palette },
      { href: "/parametres/voix", label: "Voix", icon: Mic, backoffice: true },
      { href: "/parametres/notifications", label: "Notifications", icon: Bell },
      { href: "/parametres/profil", label: "Profil", icon: UserRound, backoffice: true },
      // Each member's own instance and nothing else: the route serves its owner only.
      { href: "/parametres/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    label: "Entreprise",
    entries: [
      { href: "/parametres/membres", label: "Membres", icon: Users, adminOnly: true },
      { href: "/parametres/organigramme", label: "Organigramme", icon: Network, adminOnly: true, backoffice: true },
      { href: "/parametres/entreprise", label: "Contexte", icon: Building2, backoffice: true },
      { href: "/parametres/facturation", label: "Facturation", icon: CreditCard, adminOnly: true, backoffice: true },
      { href: "/parametres/consommation", label: "Consommation", icon: Gauge, adminOnly: true, backoffice: true },
      { href: "/parametres/instances", label: "Espaces", icon: Server, adminOnly: true },
    ],
  },
];

export function settingsEntry(pathname: string): SettingsEntry | undefined {
  const all = SETTINGS_GROUPS.flatMap((g) => g.entries);
  return all.find((e) => e.href !== "/parametres" && pathname.startsWith(e.href)) ?? all.find((e) => e.href === pathname);
}
