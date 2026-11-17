import { backoffice } from "@/lib/backoffice";
import { ApiError, handleError, json, readJson } from "@/lib/http";
import { parseMailReply } from "@/lib/mail";
import { mailToken, noStore } from "../../../../_session";

export const maxDuration = 120;

// `POST /api/mail/{expert}/messages/{id}/reply` — an answer in the thread, to the message's sender.
export async function POST(request: Request, { params }: { params: Promise<{ expert: string; id: string }> }) {
  try {
    const { expert, id } = await params;
    const reply = parseMailReply(await readJson<unknown>(request));
    if (!reply) throw new ApiError(400, "invalid_request", "Cette réponse est incomplète ou invalide.");
    return noStore(json(await backoffice.mailReply(await mailToken(), expert, id, reply)));
  } catch (e) {
    return handleError(e);
  }
}
