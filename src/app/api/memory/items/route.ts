import { backoffice } from "@/lib/backoffice";
import { handleError, json, readJson } from "@/lib/http";
import type { MemoryNote } from "@/lib/memory";
import { mailToken as sessionToken, noStore } from "../../mail/_session";

// `GET /api/memory/items` — the deposits of the company memory the member reads, and where they may
// deposit. `POST` — a note or a website (JSON) or a document (multipart, field `file`), relayed as it came: the
// back office checks the right to deposit, the file's real type and its size.
export async function GET() {
  try {
    return noStore(json(await backoffice.memoryItems(await sessionToken())));
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: Request) {
  try {
    const token = await sessionToken();
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      return noStore(json(await backoffice.uploadMemoryDocument(token, await request.formData())));
    }
    const { title, note, url, description, unit, upload } = await readJson<MemoryNote & { upload?: string }>(request);
    // A large document the browser already sent to the back office's storage.
    if (upload) return noStore(json(await backoffice.createMemoryDocument(token, { title, upload, unit })));
    // A website (`url`, read again every week by the back office) or a note.
    return noStore(json(await backoffice.createMemoryNote(token, url ? { title, url, description, unit } : { title, note, description, unit })));
  } catch (e) {
    return handleError(e);
  }
}
