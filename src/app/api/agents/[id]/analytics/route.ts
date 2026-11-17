import { after } from "next/server";
import { composioUserId } from "@/lib/composio";
import { requireAgentAccess, requireBackofficeToken } from "@/lib/auth";
import { backoffice } from "@/lib/backoffice";
import { loadCatalogue, matchCatalogue } from "@/lib/catalogue";
import type { CatalogueExpert } from "@/lib/types";
import { beforeDeadline } from "@/lib/fetch-timeout";
import { handleError, noStore } from "@/lib/http";
import { memo } from "@/lib/memo";
import { readModelGroups } from "@/lib/model-options";
import { computeAnalytics } from "@/lib/analytics/compute";
import { parseQuery } from "@/lib/analytics/query";
import { yeleSupervisionDeps } from "@/lib/yele-mcp/instance";
import type { ChannelState, DiscoveredExpert, InstanceSetup, RawConnectionInfo, RawFileInfo, SessionUsage } from "@/lib/yele-mcp/types";

// `GET /api/agents/{id}/analytics?period=&granularity=&experts=&channels=&models=&routines=` : lit
// l'instance du propriétaire connecté et renvoie les chiffres de la période, filtres appliqués.
type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 60;
/** Délai accordé à chaque source ; au-delà, la source vaut null. */
const READ_DEADLINE_MS = 45_000;

interface Reading {
  usage: SessionUsage | null;
  setup: InstanceSetup | null;
  connections: RawConnectionInfo[] | null;
  channels: ChannelState[] | null;
  experts: DiscoveredExpert[] | null;
  deliverables: RawFileInfo[] | null;
  modelLabels: Record<string, string> | null;
}

/** Id de modèle → libellé, d'après la liste des modèles du back-office. */
async function readModelLabels(): Promise<Record<string, string>> {
  const groups = readModelGroups(await backoffice.llmModels(await requireBackofficeToken("Liste des modèles indisponible."), "own")) ?? [];
  return Object.fromEntries(groups.flatMap((g) => g.models.map((m) => [m.id, m.label] as const)));
}

/** Lecture dont les sessions sont illisibles : levée pour ne pas être mise en cache. */
class PartialReading extends Error {
  readonly reading: Reading;

  constructor(reading: Reading) {
    super("sessions illisibles");
    this.reading = reading;
  }
}

// Cache des lectures par instance : 1 min fraîche, servie jusqu'à 15 min pendant une relecture.
const readings = memo<Reading>({
  ttlMs: 60_000,
  staleMs: 15 * 60_000,
  staleOnErrorMs: 15 * 60_000,
  maxEntries: 500,
  maxFlightMs: 90_000,
  background: (settled) => {
    try {
      after(() => settled);
    } catch {}
  },
});

async function catalogueExperts(): Promise<CatalogueExpert[]> {
  try {
    return (await loadCatalogue()).experts;
  } catch (e) {
    console.warn("[analytics] catalogue illisible", e);
    return [];
  }
}

/**
 * Annuaire des experts : chacun avec le titre du catalogue (titre court, sinon rôle), sinon la
 * description de son SOUL.md ; complété par le nom du catalogue pour les profils non découverts.
 */
async function directory(found: DiscoveredExpert[], usage: SessionUsage | null): Promise<DiscoveredExpert[]> {
  const catalogue = await catalogueExperts();
  const titleOf = (id: string) => {
    const c = matchCatalogue(catalogue, id);
    return c?.title ?? c?.role ?? null;
  };
  const known = new Set(found.map((e) => e.id));
  const others = [...new Set((usage?.totals ?? []).map((r) => r.profile))].filter((p) => !known.has(p));
  const named = others.flatMap((id) => {
    const c = matchCatalogue(catalogue, id);
    return c ? [{ id, name: c.name, description: titleOf(id) ?? "" }] : [];
  });
  return [...found.map((e) => ({ ...e, description: titleOf(e.id) ?? e.description })), ...named];
}

/** Lit toutes les sources de l'instance en parallèle ; une source en échec ou hors délai vaut null. */
async function read(id: string, composioUser: string): Promise<Reading> {
  const instance = yeleSupervisionDeps(id, composioUser);
  const source = <T>(what: string, load: () => Promise<T>): Promise<T | null> =>
    beforeDeadline(load(), READ_DEADLINE_MS, what).catch((e: unknown) => {
      console.warn(`[analytics] ${what} illisible sur ${id} :`, e instanceof Error ? e.message : e);
      return null;
    });
  const [found, usage, setup, connections, channels, deliverables, modelLabels] = await Promise.all([
    source("experts", instance.listInstalledExperts),
    source("sessions", instance.sessionUsage),
    source("configuration des profils", instance.instanceSetup),
    source("connexions Composio", instance.listConnections),
    source("canaux", instance.listChannels),
    source("livrables", instance.listDeliverableFiles),
    source("libellés des modèles", readModelLabels),
  ]);
  const reading: Reading = {
    usage,
    setup,
    connections,
    channels,
    experts: found === null ? null : await directory(found, usage),
    deliverables,
    modelLabels,
  };
  if (!usage) throw new PartialReading(reading);
  return reading;
}

/** Lecture en cache, nouvelle lecture, ou lecture partielle si les sessions sont illisibles. */
async function readingOf(id: string, composioUser: string): Promise<Reading> {
  try {
    return await readings.get(id, () => read(id, composioUser));
  } catch (e) {
    if (e instanceof PartialReading) return e.reading;
    throw e;
  }
}

export async function GET(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { row } = await requireAgentAccess(id);

    const query = parseQuery(new URL(request.url).searchParams);
    const reading = await readingOf(id, composioUserId(row));
    return noStore(computeAnalytics({ ...reading, ...query, now: Date.now() }));
  } catch (e) {
    return handleError(e);
  }
}
