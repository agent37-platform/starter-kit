import { composioUserId, hashAppsToken } from "@/lib/composio";
import { createAdminClient } from "@/lib/supabase/admin";
import { pinnedWorkspaceId } from "@/lib/tenant";
import { TenantError } from "@/lib/tenant-resolver";
import { createYeleSupervisionBackend } from "@/lib/yele-mcp/backend";
import { answerRpc } from "@/lib/yele-mcp/rpc";
import { yeleSupervisionDeps } from "@/lib/yele-mcp/instance";

// Yélé's supervision server (MCP): a read-only view of the whole instance (experts, conversations,
// routines, usage, connectors, channels, deliverables, memory). What it reads is in lib/yele-mcp/instance.
export const maxDuration = 120;
const MAX_BODY_BYTES = 32_768;

function errorJson(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

/** Corps de la requête en texte ; null s'il dépasse `MAX_BODY_BYTES` octets, annoncés ou lus. */
async function boundedBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function POST(request: Request): Promise<Response> {
  // Yélé's instance calls with its own token, as for `apps` and `memoire`; no browser session.
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]?.trim();
  if (!token) return errorJson(401, "missing bearer token");

  let pinned: string | undefined;
  try {
    pinned = await pinnedWorkspaceId();
  } catch (e) {
    return e instanceof TenantError && e.status < 500 ? errorJson(401, "invalid token") : errorJson(503, "token lookup unavailable");
  }
  const { data: agent, error } = await createAdminClient()
    .from("agents")
    .select("agent37_id, workspace_id, owner_user_id")
    .eq("apps_token_hash", hashAppsToken(token))
    .maybeSingle<{ agent37_id: string; workspace_id: string | null; owner_user_id: string | null }>();
  if (error) return errorJson(503, "token lookup unavailable");
  if (!agent?.agent37_id || (pinned && agent.workspace_id !== pinned)) return errorJson(401, "invalid token");

  const raw = await boundedBody(request);
  if (raw === null) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, { status: 413 });
  }
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 }
    );
  }

  const backend = createYeleSupervisionBackend(yeleSupervisionDeps(agent.agent37_id, composioUserId(agent)));

  try {
    const batch = Array.isArray(message) ? message.slice(0, 20) : [message];
    const answers = (await Promise.all(batch.map((m) => answerRpc(m, backend)))).filter((a) => a !== null);
    if (answers.length === 0) return new Response(null, { status: 202 });
    return Response.json(Array.isArray(message) ? answers : answers[0], {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.warn("[yele-mcp] Erreur lors du traitement RPC:", e instanceof Error ? e.message : e);
    return errorJson(500, "Erreur interne du serveur de supervision.");
  }
}

export function GET(): Response {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
