import { backoffice } from "@/lib/backoffice";
import { handleError, json } from "@/lib/http";
import { uploadToken } from "../_token";

type Ctx = { params: Promise<{ id: string }> };

// `DELETE /api/uploads/{id}` — a sending stopped or failed: the back office drops the parts it kept.
export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return json(await backoffice.cancelUpload(await uploadToken(), id));
  } catch (e) {
    return handleError(e);
  }
}
