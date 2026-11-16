import { backoffice } from "@/lib/backoffice";
import { ApiError, handleError, json, readJson } from "@/lib/http";
import { parseMailDraft } from "@/lib/mail";
import { mailToken, noStore } from "../../_session";

// The body carries attachments in base64: it stays under the host's own limit on a request.
export const maxDuration = 120;

// `GET /api/mail/{expert}/messages?page=` — a page of the expert's inbox, newest first.
export async function GET(request: Request, { params }: { params: Promise<{ expert: string }> }) {
  try {
    const { expert } = await params;
    const page = new URL(request.url).searchParams.get("page") ?? undefined;
    if (page !== undefined && page.length > 600) throw new ApiError(400, "invalid_request", "Cette page est introuvable.");
    return noStore(json(await backoffice.mailMessages(await mailToken(), expert, page)));
  } catch (e) {
    return handleError(e);
  }
}

// `POST /api/mail/{expert}/messages` — an e-mail sent from the expert's inbox. The back office
// allows it or refuses it; its sentence is what the member reads.
export async function POST(request: Request, { params }: { params: Promise<{ expert: string }> }) {
  try {
    const { expert } = await params;
    const draft = parseMailDraft(await readJson<unknown>(request));
    if (!draft) throw new ApiError(400, "invalid_request", "Ce message est incomplet ou invalide.");
    return noStore(json(await backoffice.mailSend(await mailToken(), expert, draft)));
  } catch (e) {
    return handleError(e);
  }
}
