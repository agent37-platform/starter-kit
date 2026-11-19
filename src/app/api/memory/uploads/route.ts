import { backoffice } from "@/lib/backoffice";
import { handleError, json, readJson } from "@/lib/http";
import { mailToken as sessionToken, noStore } from "../../mail/_session";

// `POST /api/memory/uploads` — where the browser sends a document too large for this app (over 4 MB),
// asked of the back office, which checks the right to deposit, the type and the size.
export async function POST(request: Request) {
  try {
    const { name, size, type, unit } = await readJson<{ name: string; size: number; type: string; unit?: string | null }>(request);
    return noStore(json(await backoffice.startMemoryUpload(await sessionToken(), { name, size, type, unit })));
  } catch (e) {
    return handleError(e);
  }
}
