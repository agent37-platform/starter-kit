import { backoffice } from "@/lib/backoffice";
import { ApiError, handleError, json } from "@/lib/http";
import { MAX_DOCUMENT_BYTES, PART_BYTES } from "@/lib/upload-limit";
import { uploadToken } from "../../../_token";

type Ctx = { params: Promise<{ id: string; n: string }> };

const MAX_PARTS = Math.ceil(MAX_DOCUMENT_BYTES / PART_BYTES);

// `POST /api/uploads/{id}/parts/{n}` — one part of 3 MB at most, its raw bytes, relayed to the back office.
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id, n } = await params;
    const index = Number(n);
    if (!/^\d{1,2}$/.test(n) || index >= MAX_PARTS) throw new ApiError(400, "invalid_request", "Demande incomplète.");
    const token = await uploadToken();
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) throw new ApiError(400, "invalid_request", "Demande incomplète.");
    if (bytes.byteLength > PART_BYTES) throw new ApiError(413, "too_large", "Ce morceau dépasse 3 Mo.");
    return json(await backoffice.uploadPart(token, id, index, bytes));
  } catch (e) {
    return handleError(e);
  }
}

export const maxDuration = 120;
