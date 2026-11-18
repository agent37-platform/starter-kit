import "server-only";
import { catalogueCycle, catalogueJob } from "@/lib/expert-cycle";
import { backofficeAgentRow, type DB } from "@/lib/auth";
import { loadCatalogue, matchCatalogue } from "@/lib/catalogue";
import { expertDisplayName } from "@/lib/experts";
import { orderExperts } from "@/lib/expert-order";
import { authViaBackoffice } from "@/lib/runtime-config";
import { isCompanionProfile, type Companion } from "@/lib/companion";
import { currentInstallation, currentInstance } from "@/lib/session";
import { listInstanceProfiles } from "@/lib/hermes-profiles";
import { ApiError, dbError } from "@/lib/http";
import type { AgentRow, CatalogueResponse, Expert, InstalledExpert } from "@/lib/types";

// The profiles installed on the instance a user owns (admins included: nobody sees a colleague's).
// Shared by the experts list and the catalogue, so both screens agree on what "installed" means.

export interface InstalledProfile {
  agent: AgentRow;
  profileId: string;
  /** Known only when the instance was asked directly; null when read from the database. */
  gateway: string | null;
  distribution: string | null;
}

export interface InstalledProfiles {
  profiles: InstalledProfile[];
  /** Instances that could not be read — to be shown, never hidden. */
  unreadable: AgentRow[];
}

export async function visibleAgents(db: DB, workspaceId: string, userId: string): Promise<AgentRow[]> {
  if (authViaBackoffice()) {
    // The back office says which instance is the caller's, with the experts installed on it.
    const row = await backofficeAgentRow();
    return row && row.workspace_id === workspaceId && row.owner_user_id === userId ? [row] : [];
  }
  const { data, error } = await db
    .from("agents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw dbError(error);
  return (data ?? []) as AgentRow[];
}

// The back office mirrors each instance's installed profiles on its agents row (agents.profiles).
// That is one query and wakes nothing. A row it has not filled yet falls back to asking the
// instance (an exec: seconds, and it wakes a sleeping instance).
export async function installedProfiles(agents: AgentRow[]): Promise<InstalledProfiles> {
  const profiles: InstalledProfile[] = [];
  const unreadable: AgentRow[] = [];

  const results = await Promise.allSettled(
    agents.map(async (agent): Promise<InstalledProfile[]> => {
      if (Array.isArray(agent.profiles) && agent.profiles.length > 0) {
        return agent.profiles.map((profileId) => ({ agent, profileId, gateway: null, distribution: null }));
      }
      const live = await listInstanceProfiles(agent.agent37_id);
      return live.profiles.map((p) => ({ agent, profileId: p.id, gateway: p.gateway, distribution: p.distribution }));
    })
  );
  results.forEach((res, i) => {
    if (res.status === "fulfilled") profiles.push(...res.value);
    else unreadable.push(agents[i]);
  });
  return { profiles, unreadable };
}

/** True when listing these instances' profiles asks nothing of the instances themselves. */
export function profilesMirrored(agents: AgentRow[]): boolean {
  return agents.every((a) => Array.isArray(a.profiles) && a.profiles.length > 0);
}

export interface UserExperts {
  experts: Expert[];
  /** Yélé where her profile is installed; she is not among `experts`. */
  companion: Companion | null;
  unreadable: { agentId: string; agentName: string | null }[];
  /** True while the back office is still creating the instance or installing experts on it. */
  installing: boolean;
  /** True when nothing is under way any more and the instance, or an expert, failed to install. */
  failed: boolean;
  /** Names of the experts whose installation failed. */
  failedExperts: string[];
}

// The back office says so itself; without it nothing here can tell, and nothing is reported.
async function installation(): Promise<{ installation: "running" | "ready" | "failed"; failedExperts: string[] }> {
  const none = { installation: "ready" as const, failedExperts: [] };
  if (!authViaBackoffice()) return none;
  return (await currentInstallation().catch(() => null)) ?? none;
}

// The name and picture the member chose for each of their experts, and the cycle that brought it, by
// profile, as the back office keeps them. None where it does not sign users in.
async function memberLooks(): Promise<
  Map<string, { displayName: string | null; avatarUrl: string | null; cycle: { key: string; label: string } | null; since: string | null }>
> {
  if (!authViaBackoffice()) return new Map();
  const instance = await currentInstance().catch(() => null);
  return new Map(
    (instance?.experts ?? []).map((e) => [
      e.profile,
      {
        displayName: e.displayName ?? null,
        avatarUrl: e.avatarUrl ?? null,
        cycle: e.cycle?.key && e.cycle.label ? { key: e.cycle.key, label: e.cycle.label } : null,
        since: e.since ?? null,
      },
    ])
  );
}

// The experts of these instances as the screens show them: each installed profile dressed by the
// back office's catalogue (name, role, portrait), or named after its profile id without one, under
// the name and picture its member chose. The drive folder keeps the catalogue's name. An
// instance that cannot be read does not take the others down: it is reported in `unreadable`.
// Shared by the experts route and the shell's first render, so both say the same thing.
export async function userExperts(agents: AgentRow[]): Promise<UserExperts> {
  // Asked at once: it does not depend on the installation's state.
  const catalogueRead = loadCatalogue();
  const state = await installation();
  const installing = state.installation === "running";
  // An instance being set up is not asked for its profiles: the experts are the ones the back
  // office reports installed, and the rest arrive when it is done.
  const readable = installing ? agents.filter((a) => Array.isArray(a.profiles) && a.profiles.length > 0) : agents;
  const [{ profiles, unreadable }, catalogue, looks] = await Promise.all([installedProfiles(readable), catalogueRead, memberLooks()]);

  const yele = profiles.find((p) => isCompanionProfile(p.profileId));
  const experts: Expert[] = profiles.filter((p) => !isCompanionProfile(p.profileId)).map((p) => {
    const entry = matchCatalogue(catalogue.experts, p.profileId);
    const look = looks.get(p.profileId);
    return {
      profileId: p.profileId,
      displayName: look?.displayName || entry?.name || expertDisplayName(p.profileId),
      agentId: p.agent.agent37_id,
      agentName: p.agent.name,
      gateway: p.gateway,
      distribution: p.distribution,
      catalogueKey: entry?.key ?? null,
      role: entry?.role ?? null,
      title: catalogueJob({ catalogueKey: entry?.key ?? null, profileId: p.profileId }, entry?.title ?? null),
      tagline: entry?.tagline ?? null,
      suggestions: entry?.suggestions ?? [],
      photoUrl: look?.avatarUrl || entry?.avatarUrl || null,
      driveFolder: entry?.driveFolder ?? entry?.name ?? null,
      cycle: catalogueCycle({ catalogueKey: entry?.key ?? null, profileId: p.profileId }, look?.cycle ?? null),
      since: look?.since ?? null,
    };
  });

  return {
    experts: orderExperts(experts, catalogue.defaultExpertKey),
    companion: yele ? { agentId: yele.agent.agent37_id, profileId: yele.profileId } : null,
    unreadable: unreadable.map((a) => ({ agentId: a.agent37_id, agentName: a.name })),
    installing,
    failed: state.installation === "failed",
    // Named as the catalogue names them; a key it does not know is shown as a first name.
    failedExperts: state.failedExperts.map((key) => catalogue.experts.find((e) => e.key === key)?.name ?? expertDisplayName(key)),
  };
}

/** Every expert Yelema offers, with where each one is installed for this user (the gallery's list). */
export async function catalogueWithInstalled(agents: AgentRow[]): Promise<CatalogueResponse> {
  const [{ profiles }, catalogue] = await Promise.all([installedProfiles(agents), loadCatalogue()]);
  const installed = new Map<string, InstalledExpert[]>();
  for (const p of profiles) {
    const entry = matchCatalogue(catalogue.experts, p.profileId);
    if (!entry) continue;
    const list = installed.get(entry.key) ?? [];
    list.push({ agentId: p.agent.agent37_id, agentName: p.agent.name, profileId: p.profileId });
    installed.set(entry.key, list);
  }
  return {
    available: catalogue.available,
    defaultExpertKey: catalogue.defaultExpertKey,
    categories: catalogue.categories,
    experts: catalogue.experts.map((e) => ({ ...e, installed: installed.get(e.key) ?? [] })),
  };
}
