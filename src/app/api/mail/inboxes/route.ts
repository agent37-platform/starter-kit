import { requireBackofficeToken } from "@/lib/auth";
import { backoffice, BackofficeError } from "@/lib/backoffice";
import { ApiError, handleError, json, readJson } from "@/lib/http";
import { isExpertKey, parseCreateMailInboxInput, parseMailTarget, type MailTarget } from "@/lib/mail";
import { authViaBackoffice } from "@/lib/runtime-config";
import { mailToken, noStore } from "../_session";

const UNAVAILABLE = "Les e-mails des experts ne sont pas disponibles.";
const ADMINS_ONLY = "Seul un administrateur attribue ou retire l’adresse e-mail d’un expert.";

const adminToken = (): Promise<string> => requireBackofficeToken(UNAVAILABLE, { admin: ADMINS_ONLY });

function targetOf(params: URLSearchParams): MailTarget {
  const target = parseMailTarget(params.get("agentId") ?? undefined, params.get("member") ?? undefined);
  if (!target) throw new ApiError(400, "invalid_request", "Instance introuvable.");
  return target;
}

// `GET /api/mail/inboxes?agentId=` (or `?member=` for an admin) — the experts' inboxes of an instance. The
// back office decides who may see which. Where the feature is off `enabled` is false and no tab shows.
export async function GET(request: Request) {
  try {
    if (!authViaBackoffice()) return noStore(json({ items: [], enabled: false }));
    const target = targetOf(new URL(request.url).searchParams);
    const token = await mailToken();
    try {
      return noStore(json({ items: await backoffice.mailInboxes(token, target), enabled: true }));
    } catch (e) {
      if (e instanceof BackofficeError && e.status === 404) return noStore(json({ items: [], enabled: false }));
      throw e;
    }
  } catch (e) {
    return handleError(e);
  }
}

// `POST /api/mail/inboxes` — an admin opens the inbox of an expert on a member's instance (theirs included).
export async function POST(request: Request) {
  try {
    const token = await adminToken();
    const input = parseCreateMailInboxInput(await readJson<unknown>(request));
    if (!input) throw new ApiError(400, "invalid_request", "La demande de création de boîte e-mail est invalide.");
    return noStore(json({ inbox: await backoffice.createMailInbox(token, input) }));
  } catch (e) {
    return handleError(e);
  }
}

// `DELETE /api/mail/inboxes?expert=&agentId=` (or `&member=`) — an admin closes an inbox; the back office
// deletes it for good 30 days later, and it can be opened again until then.
export async function DELETE(request: Request) {
  try {
    const token = await adminToken();
    const params = new URL(request.url).searchParams;
    const expert = params.get("expert") ?? "";
    if (!isExpertKey(expert)) throw new ApiError(400, "invalid_request", "Cet expert est introuvable.");
    await backoffice.deleteMailInbox(token, expert, targetOf(params));
    return noStore(json({ deleted: true }));
  } catch (e) {
    return handleError(e);
  }
}
