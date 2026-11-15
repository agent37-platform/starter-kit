import { instanceFetch } from "@/lib/agent37";
import { requireAgentAccess } from "@/lib/auth";
import { ApiError, handleError } from "@/lib/http";
import { upstreamErrorMessage } from "../../../../_helpers";

type Ctx = { params: Promise<{ id: string; responseId: string }> };

// Reattach to a turn's SSE stream (GET /v1/responses/{id}/stream on the instance). The gateway
// replays every event so far — from response.created through the latest delta — then stays
// attached live, so a thread switch or reload never loses a running answer. A 404 means the
// response record expired (~30 min after finishing, or a gateway restart); callers fall back to
// the session transcript.
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id, responseId } = await params;
    await requireAgentAccess(id);

    const upstream = await instanceFetch(id, `/v1/responses/${encodeURIComponent(responseId)}/stream`, {
      headers: { Accept: "text/event-stream" },
    });

    if (!upstream.ok || !upstream.body) {
      const message = await upstreamErrorMessage(upstream, "chat/responses/stream", "La réponse en cours n’a pas pu être reprise.");
      throw new ApiError(upstream.status || 502, "upstream_error", message);
    }

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

// Reattached streams can ride along for the rest of a long turn, same as the POST stream.
export const maxDuration = 800;
