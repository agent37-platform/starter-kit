import { accountState } from "../../connection-accounts.ts";
import type { CallCountRow, RawConnectionInfo } from "../../yele-mcp/types.ts";
import { connectorLabel } from "../names.ts";
import type { Dimension } from "../types.ts";
import { callsDimension, plural, whoLabel } from "./calls.ts";

interface Toolkit {
  name: string | null;
  active: number;
}

function toolkitsOf(connections: RawConnectionInfo[]): Map<string, Toolkit> {
  const out = new Map<string, Toolkit>();
  for (const c of connections) {
    const slug = c.toolkitSlug?.toLowerCase();
    if (!slug) continue;
    const t = out.get(slug) ?? out.set(slug, { name: null, active: 0 }).get(slug)!;
    t.name ??= c.toolkitName ?? null;
    if (accountState({ status: c.status ?? "", isDisabled: c.isDisabled ?? false }) === "active") t.active++;
  }
  return out;
}

/** Service d'une action : le plus long service connu qui préfixe son slug, sinon le premier mot du slug. */
export function toolkitOfAction(action: string, known: Iterable<string>): string {
  const slug = action.toLowerCase();
  const match = [...known].filter((k) => slug.startsWith(`${k}_`)).sort((a, b) => b.length - a.length)[0];
  return match ?? slug.split("_")[0];
}

function accountsLabel(t: Toolkit | undefined): string {
  if (!t) return "Non connecté";
  if (t.active === 0) return "Déconnecté";
  return plural(t.active, "compte connecté", "comptes connectés");
}

export function connectorsTab(actions: CallCountRow[], connections: RawConnectionInfo[] | null, nameOf: (profile: string) => string): Dimension {
  const toolkits = toolkitsOf(connections ?? []);
  return callsDimension(
    actions,
    (r) => toolkitOfAction(r.name, toolkits.keys()),
    (slug, g, share) => {
      const t = toolkits.get(slug);
      const { name, logo } = connectorLabel(slug, t?.name ?? null);
      return {
        id: `connector_${slug}`,
        name,
        logo,
        subtitle: [connections ? accountsLabel(t) : null, whoLabel(g.profiles, nameOf)].filter(Boolean).join(" · "),
        iconKind: "connector",
        share,
        volume: null,
        count: g.calls,
      };
    }
  );
}
