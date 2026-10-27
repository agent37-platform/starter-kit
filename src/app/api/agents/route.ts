import { agent37 } from "@/lib/agent37";
import { requireAdmin, requireMember, requireUser } from "@/lib/auth";
import { AGENT_TEMPLATES, DEFAULT_AGENT, templateAppPorts } from "@/config/agents";
import { usdToMicros } from "@/lib/format";
import { ApiError, handleError, json, readJson } from "@/lib/http";
import type { Agent, AgentRow, MergedAgent, Template } from "@/lib/types";

// The image catalog barely changes, but the dashboard polls this route every 5s while any agent is
// transitioning — so cache the template list briefly rather than re-fetching /templates on every
// poll (and on create). Module-scoped + best-effort: a stale entry only delays an agent's
// `update_available` flag by at most the TTL.
let templateCache: { at: number; data: Template[] } | null = null;
const TEMPLATES_TTL_MS = 60_000;

async function getTemplates(): Promise<Template[]> {
  if (templateCache && Date.now() - templateCache.at < TEMPLATES_TTL_MS) return templateCache.data;
  const { data } = await agent37.listTemplates();
  templateCache = { at: Date.now(), data };
  return data;
}

async function resolveTemplate(): Promise<string | undefined> {
  try {
    const data = await getTemplates();
    const preferred = data.find((t) => t.name === DEFAULT_AGENT.template);
    if (preferred) return preferred.name;
    const builtin = data.find((t) => t.scope === "system");
    return (builtin ?? data[0])?.name;
  } catch {
    return DEFAULT_AGENT.template;
  }
}

export async function GET(request: Request) {
  try {
    const { db, user } = await requireUser();
    const workspaceId = new URL(request.url).searchParams.get("workspace");
    if (!workspaceId) throw new ApiError(400, "invalid_request", "workspace query param is required");

    const role = await requireMember(db, workspaceId, user.id);

    const { data: rows, error } = await db
      .from("agents")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw new ApiError(500, "db_error", error.message);

    let live = new Map<string, Agent>();
    let templates = new Map<string, Template>();
    const [liveRes, tmplRes] = await Promise.allSettled([
      agent37.listAgents(),
      getTemplates(),
    ]);
    if (liveRes.status === "fulfilled") {
      live = new Map(liveRes.value.data.map((i) => [i.id, i]));
    }
    if (tmplRes.status === "fulfilled") {
      templates = new Map(tmplRes.value.map((t) => [t.name, t]));
    }

    // Registry-pushed templates carry an image_ref to compare; cloud-built ones don't —
    // for those the template's revision vs the instance's installed template_revision
    // (missing revisions read as 1) is the documented update signal.
    function updateAvailable(l: Agent | undefined): boolean {
      const t = l && templates.get(l.template);
      if (!l || !t) return false;
      if (t.image_ref) return !!l.image_ref && l.image_ref !== t.image_ref;
      return (t.revision ?? 1) > (l.template_revision ?? 1);
    }

    const agents: MergedAgent[] = (rows as AgentRow[]).map((row) => {
      const l = live.get(row.agent37_id);
      if (l && l.status !== row.status) {
        // Best-effort mirror sync. Authorized already: these rows belong to workspaceId, which the
        // caller is a member of (requireMember above).
        db.from("agents").update({ status: l.status }).eq("agent37_id", row.agent37_id).then(() => {});
      }
      return {
        ...row,
        cpu: l?.resources.cpu ?? row.cpu,
        memory: l?.resources.memory ?? row.memory,
        disk: l?.resources.disk ?? row.disk,
        live_status: l?.status ?? row.status,
        status_reason: l?.status_reason ?? null,
        past_due: l?.past_due ?? false,
        ports:
          l?.ports?.length
            ? l.ports
            : templateAppPorts(l?.template ?? row.template).map((port) => ({
                port,
                default: false,
                url: `https://${row.agent37_id}-${port}.agent37.app`,
              })),
        update_available: updateAvailable(l),
      };
    });

    return json({ agents, role });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser();
    // Shape is fixed server-side (DEFAULT_AGENT); the client picks the workspace and agent type.
    const body = await readJson<{ workspace_id?: string; template?: string }>(request);

    const workspaceId = body.workspace_id;
    if (!workspaceId) throw new ApiError(400, "invalid_request", "workspace_id is required");
    await requireAdmin(db, workspaceId, user.id);

    // Paywall/entitlement seam: a fork can gate agent creation here, e.g.
    // if (!(await canCreateAgent(db, workspaceId))) throw new ApiError(403, "forbidden", "Agent creation is not enabled for this workspace.");

    const template =
      body.template && AGENT_TEMPLATES.includes(body.template)
        ? body.template
        : await resolveTemplate();

    const agent = await agent37.createAgent({
      template,
      resources: {
        cpu: DEFAULT_AGENT.cpu,
        memory: DEFAULT_AGENT.memory,
        disk: DEFAULT_AGENT.disk,
      },
      metadata: { app_workspace: workspaceId },
      budget: { monthly_cap_micros: usdToMicros(DEFAULT_AGENT.monthlyCapUsd) },
    });

    const { error } = await db.from("agents").insert({
      agent37_id: agent.id,
      workspace_id: workspaceId,
      name: agent.name || null,
      status: agent.status,
      template: agent.template,
      cpu: agent.resources.cpu,
      memory: agent.resources.memory,
      disk: agent.resources.disk,
      created_by: user.id,
    });
    if (error) {
      // Roll back the orphaned agent so we never bill for an untracked box.
      try {
        await agent37.deleteAgent(agent.id);
      } catch {
        /* best-effort */
      }
      throw new ApiError(500, "db_error", error.message);
    }

    return json(agent, 201);
  } catch (e) {
    return handleError(e);
  }
}
