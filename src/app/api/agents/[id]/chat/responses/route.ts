import { instanceFetch } from "@/lib/agent37";
import { requireAgentAccess } from "@/lib/auth";
import { assertInDrive } from "@/lib/drive";
import { ApiError, handleError, readJson } from "@/lib/http";
import { DEFAULT_PROFILE, resolveProfile } from "@/lib/profiles";
import { messageKeyOf } from "@/lib/turn-idempotency";
import { FILES_ONLY_PROMPT } from "@/lib/types";
import { upstreamErrorMessage } from "../../_helpers";

type Ctx = { params: Promise<{ id: string }> };

const MAX_FILES = 20;

interface ResponsesBody {
  input?: string;
  session_id?: string;
  // The expert to talk to: a Hermes profile installed on this instance. Absent = the default home.
  profile?: string | null;
  model?: string | null;
  provider?: string | null;
  reasoning_effort?: string | null;
  files?: string[];
  // Sent again after a cut, the same key makes the gateway join the turn it already started.
  client_message_id?: string;
}

// Run a chat turn and stream the agent's reply back as Server-Sent Events. We authorize +
// validate BEFORE the first byte (status/headers lock once streaming starts), then pipe the
// instance's SSE straight through; the try/catch still turns any pre-stream throw into the
// canonical { error: { code, message } } shape so the client's apiFetch can read it.
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { row } = await requireAgentAccess(id);

    const body = await readJson<ResponsesBody>(request);
    const profile = await resolveProfile(row, body.profile);
    const input = (body.input ?? "").trim();
    // The attachments of a turn are paths the expert will read: like every files route, only the
    // drive is accepted, so a turn cannot hand ~/.hermes or ~/.yelema to the model.
    const given = Array.isArray(body.files) ? body.files.filter(Boolean) : [];
    if (given.length > MAX_FILES || given.some((f) => typeof f !== "string")) {
      throw new ApiError(400, "invalid_request", "Pièces jointes invalides.");
    }
    const files = given.map((f) => assertInDrive(f));
    if (!input && files.length === 0) {
      throw new ApiError(400, "invalid_request", "Écrivez un message ou joignez un fichier.");
    }
    // The Agents API marks `input` required; for a files-only turn supply a sensible default
    // prompt so we always send a non-empty input rather than relying on "" being accepted.
    const finalInput = input || FILES_ONLY_PROMPT;

    // Forward only what the Agents API expects; omit null/empty so the agent's own defaults
    // apply (model/provider/effort). provider only rides along when a model is chosen.
    const payload: Record<string, unknown> = { input: finalInput, stream: true };
    // The profile is per request on the instance, not remembered by the session: send it every turn.
    if (profile !== DEFAULT_PROFILE) payload.profile = profile;
    if (body.session_id) payload.session_id = body.session_id;
    if (body.model) {
      payload.model = body.model;
      if (body.provider) payload.provider = body.provider;
    }
    if (body.reasoning_effort) payload.reasoning_effort = body.reasoning_effort;
    if (files.length) payload.files = files;
    const key = messageKeyOf(body.client_message_id);
    if (key) payload.client_message_id = key;

    const upstream = await instanceFetch(id, "/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok || !upstream.body) {
      if (profile !== DEFAULT_PROFILE && upstream.status === 404) {
        await upstream.body?.cancel().catch(() => undefined);
        throw new ApiError(404, "profile_not_found", "Cet expert n’est pas installé sur cet espace.");
      }
      const message = await upstreamErrorMessage(upstream, "chat/responses", "Votre expert n’a pas pu répondre. Réessayez dans un instant.");
      // An instance too old for profiles refuses the field instead of silently using the default home.
      if (profile !== DEFAULT_PROFILE && upstream.status === 400) {
        throw new ApiError(502, "profile_unsupported", "Cet espace doit être mis à jour pour parler à cet expert. Contactez Yelema.");
      }
      // The client softens the "busy" case by matching the message, not a code, and the 409 is
      // preserved in the status — so one code suffices.
      throw new ApiError(upstream.status || 502, "upstream_error", message);
    }

    // Pipe the SSE body straight through to the browser.
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

// Chat turns (especially with tools) can run for a while: the ceiling of Vercel Fluid Compute (Pro).
export const maxDuration = 800;
