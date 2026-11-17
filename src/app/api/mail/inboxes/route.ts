import { requireAgentAccess } from "@/lib/auth";
import { backoffice, BackofficeError } from "@/lib/backoffice";
import { ApiError, handleError, json, readJson } from "@/lib/http";
import { isExpertKey, parseCreateMailInboxInput } from "@/lib/mail";
import { authViaBackoffice } from "@/lib/runtime-config";
import { mailToken, noStore } from "../_session";

const UNAVAILABLE = "Les e-mails des experts ne sont pas disponibles.";

/** L'instance de la requête, une fois vérifié qu'elle est celle du membre connecté. */
async function ownAgentId(agentId: string | null | undefined): Promise<string> {
  if (!agentId) throw new ApiError(400, "invalid_request", "Instance introuvable.");
  await requireAgentAccess(agentId);
  return agentId;
}

// `GET /api/mail/inboxes?agentId=` — the experts' inboxes of the member's instance. Where the feature
// is off (another sign-in mode, or the back office answers 404) `enabled` is false and no tab shows.
export async function GET(request: Request) {
  try {
    if (!authViaBackoffice()) return noStore(json({ items: [], enabled: false }));
    const agentId = await ownAgentId(new URL(request.url).searchParams.get("agentId"));
    const token = await mailToken();
    try {
      return noStore(json({ items: await backoffice.mailInboxes(token, agentId), enabled: true }));
    } catch (e) {
      if (e instanceof BackofficeError && e.status === 404) return noStore(json({ items: [], enabled: false }));
      throw e;
    }
  } catch (e) {
    return handleError(e);
  }
}

// `POST /api/mail/inboxes` — creates the inbox of an expert of the member's instance.
export async function POST(request: Request) {
  try {
    if (!authViaBackoffice()) throw new ApiError(404, "not_available", UNAVAILABLE);
    const input = parseCreateMailInboxInput(await readJson<unknown>(request));
    if (!input) throw new ApiError(400, "invalid_request", "La demande de création de boîte e-mail est invalide.");
    await ownAgentId(input.agentId);
    const inbox = await backoffice.createMailInbox(await mailToken(), input);
    return noStore(json({ inbox }, 201));
  } catch (e) {
    return handleError(e);
  }
}

// `DELETE /api/mail/inboxes?expert=&agentId=` — deletes for good the inbox of an expert of the member's instance.
export async function DELETE(request: Request) {
  try {
    if (!authViaBackoffice()) throw new ApiError(404, "not_available", UNAVAILABLE);
    const params = new URL(request.url).searchParams;
    const expert = params.get("expert") ?? "";
    if (!isExpertKey(expert)) throw new ApiError(400, "invalid_request", "Cet expert est introuvable.");
    const agentId = await ownAgentId(params.get("agentId"));
    await backoffice.deleteMailInbox(await mailToken(), expert, agentId);
    return noStore(json({ deleted: true }));
  } catch (e) {
    return handleError(e);
  }
}
