// The accounts of each tool on the Connecteurs screen: every connection is listed, stale or duplicate
// ones included, so each can be removed on its own. Pure, so `node --test` runs it as is.
import type { IntegrationConnection } from "./types";

export type AccountState = "active" | "pending" | "failed" | "disabled";

export const ACCOUNT_STATE_LABELS: Record<AccountState, string> = {
  active: "Connecté",
  pending: "Connexion non terminée",
  failed: "En échec",
  disabled: "Désactivé",
};

export function accountState(c: Pick<IntegrationConnection, "status" | "isDisabled">): AccountState {
  const s = (c.status || "").toUpperCase();
  if (c.isDisabled || s === "INACTIVE" || s === "DISABLED") return "disabled";
  if (s === "ACTIVE") return "active";
  if (s === "INITIATED" || s === "INITIALIZING" || s === "PENDING") return "pending";
  return "failed";
}

const slugKey = (slug: string | null | undefined): string => (slug || "").toLowerCase();

/** Accounts by tool slug, active first, then the most recent. */
export function accountsBySlug(conns: readonly IntegrationConnection[]): Map<string, IntegrationConnection[]> {
  const out = new Map<string, IntegrationConnection[]>();
  for (const c of conns) {
    const k = slugKey(c.toolkitSlug);
    if (!k || !c.id) continue;
    out.set(k, [...(out.get(k) ?? []), c]);
  }
  for (const [k, list] of out) {
    out.set(
      k,
      [...list].sort(
        (a, b) =>
          Number(accountState(b) === "active") - Number(accountState(a) === "active") ||
          (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0)
      )
    );
  }
  return out;
}

/** A short, stable label for an account: Composio gives no name, so the end of its id. */
export function accountLabel(c: IntegrationConnection, index: number): string {
  const tail = c.id.replace(/^ca_/, "").slice(-8);
  return `Compte ${index + 1} · ${tail}`;
}

/** What the screen calls an account: the member's label, else its e-mail, else its name, else a chosen alias, else its rank. */
export function accountTitle(c: IntegrationConnection, index: number): string {
  return c.label || c.email || c.accountName || (c.alias && !DRAWN_ALIAS.test(c.alias) ? c.alias : null) || `Compte ${index + 1}`;
}

// The alias drawn when the member chose none (`gmail-a1b2c3`, older `gmail-2`): no name for anyone.
const DRAWN_ALIAS = /^[a-z0-9_]+-(?:[0-9a-f]{6}|\d+)$/;

/** What the back office keeps about each account, laid over Composio's list (unknown ids stay as they are). */
export function withAccountDetails(conns: readonly IntegrationConnection[], details: readonly BoAccountDetails[]): IntegrationConnection[] {
  const byId = new Map(details.map((d) => [d.id, d]));
  return conns.map((c) => {
    const d = byId.get(c.id);
    return d ? { ...c, email: d.email ?? c.email ?? null, accountName: d.name ?? c.accountName ?? null, label: d.label, isDefault: d.isDefault, addedBy: d.addedBy } : c;
  });
}

export type BoAccountDetails = { id: string; email: string | null; name: string | null; label: string | null; isDefault: boolean; addedBy: { email: string; name: string | null } | null };

/** Composio's `connectedAccounts` pin: the chosen default alone, since a pin is exact and the order of a list is undocumented. */
export function pinnedAccounts(defaults: Readonly<Record<string, string>>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(defaults).sort(([a], [b]) => a.localeCompare(b)).map(([toolkit, id]) => [toolkit, [id]]));
}

/** Accounts that work or did, apart from the sign-ins never finished (cleared together). */
export function splitAccounts(list: readonly IntegrationConnection[]): {
  accounts: IntegrationConnection[];
  unfinished: IntegrationConnection[];
} {
  return {
    accounts: list.filter((c) => accountState(c) !== "pending"),
    unfinished: list.filter((c) => accountState(c) === "pending"),
  };
}

export const needsReconnect = (c: IntegrationConnection): boolean => {
  const s = accountState(c);
  return s === "failed" || s === "disabled";
};

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** The tool card's one line: « 3 comptes · 1 à reconnecter ». */
export function accountSummary(list: readonly IntegrationConnection[]): string {
  const { accounts, unfinished } = splitAccounts(list);
  if (accounts.length === 0) return unfinished.length ? ACCOUNT_STATE_LABELS.pending : "";
  const broken = accounts.filter(needsReconnect).length;
  const head = plural(accounts.length, "compte", "comptes");
  return broken ? `${head}, ${broken} à reconnecter` : head;
}
