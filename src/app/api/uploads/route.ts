import { backoffice } from "@/lib/backoffice";
import { ApiError, handleError, json, readJson } from "@/lib/http";
import { MAX_DOCUMENT_BYTES, PART_BYTES, TOO_LARGE_DOCUMENT } from "@/lib/upload-limit";
import { uploadToken } from "./_token";

// `POST /api/uploads` — starts sending a document in parts (lib/upload-parts.ts): its name, type, size and number
// of parts. The back office answers the id the parts go under.
export async function POST(request: Request) {
  try {
    const token = await uploadToken();
    const { name, type, size, parts } = await readJson<{ name?: unknown; type?: unknown; size?: unknown; parts?: unknown }>(request);
    if (typeof name !== "string" || !name.trim() || typeof size !== "number" || !Number.isInteger(size) || size <= 0 || parts !== Math.ceil(size / PART_BYTES)) {
      throw new ApiError(400, "invalid_request", "Demande incomplète.");
    }
    if (size > MAX_DOCUMENT_BYTES) throw new ApiError(413, "too_large", TOO_LARGE_DOCUMENT);
    const meta = { name: name.trim().slice(0, 255), type: typeof type === "string" && type ? type.slice(0, 200) : "application/octet-stream", size, parts };
    return json(await backoffice.startUpload(token, meta), 201);
  } catch (e) {
    return handleError(e);
  }
}
