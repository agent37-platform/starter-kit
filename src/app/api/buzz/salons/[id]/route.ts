import { backoffice } from "@/lib/backoffice";
import { handleError, json, readJson } from "@/lib/http";
import { mailToken as sessionToken, noStore } from "../../../mail/_session";

// `PATCH /api/buzz/salons/<id>` renames a salon opened from the app, `DELETE` removes it for all (the back office refuses a unit salon).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { nom } = await readJson<{ nom?: unknown }>(request);
    return noStore(json(await backoffice.buzzRenameSalon(await sessionToken(), id, typeof nom === "string" ? nom.slice(0, 60) : "")));
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return noStore(json(await backoffice.buzzDeleteSalon(await sessionToken(), id)));
  } catch (e) {
    return handleError(e);
  }
}
