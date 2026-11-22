import { instanceFetch } from "@/lib/agent37";
import { requireAgentAccess } from "@/lib/auth";
import { backoffice } from "@/lib/backoffice";
import { ATTACHMENTS_DIR, assertInDrive } from "@/lib/drive";
import { ApiError, handleError, json, readJson } from "@/lib/http";
import type { UploadDestination } from "@/lib/upload-parts";
import { assertUpstreamOk } from "../../../agents/[id]/_helpers";
import { uploadToken } from "../../_token";

type Ctx = { params: Promise<{ id: string }> };

const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

// `POST /api/uploads/{id}/complete` — every part is there: where the document goes. A chat attachment or a drive
// file is written on the expert's instance here, with the same access check as a small one (chat/files,
// files/content); the back office's copy is dropped after. A memory document is filed by the back office itself.
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { to } = await readJson<{ to?: UploadDestination }>(request);
    const token = await uploadToken();

    if (to?.kind === "memory") {
      if (typeof to.title !== "string" || !to.title.trim()) throw new ApiError(400, "invalid_request", "Demande incomplète.");
      return json(await backoffice.uploadToMemory(token, id, { title: to.title.trim().slice(0, 255), unit: typeof to.unit === "string" ? to.unit : null }));
    }
    if (to?.kind === "memory-version") {
      if (typeof to.item !== "string" || !to.item) throw new ApiError(400, "invalid_request", "Demande incomplète.");
      return json(await backoffice.uploadToMemory(token, id, { item: to.item }));
    }
    if ((to?.kind !== "chat" && to?.kind !== "drive") || typeof to.agentId !== "string" || !AGENT_ID.test(to.agentId)) {
      throw new ApiError(400, "invalid_request", "Demande incomplète.");
    }
    const agentId = to.agentId;
    await requireAgentAccess(agentId);

    const file = await backoffice.uploadedFile(token, id);
    const type = file.headers.get("content-type") ?? "application/octet-stream";
    // Named by the back office from the name given at the start.
    const name = (/filename\*=UTF-8''([^;]+)/.exec(file.headers.get("content-disposition") ?? "")?.[1] ?? "fichier").replace(/[/\\]/g, "_");
    const bytes = await file.arrayBuffer();

    let target: string;
    const qs = new URLSearchParams();
    if (to.kind === "chat") {
      // Same naming as a small attachment (chat/files): a short random prefix, in « Pièces jointes ».
      target = `${ATTACHMENTS_DIR}/${Math.random().toString(36).slice(2, 10)}-${decodeURIComponent(name)}`;
    } else {
      if (typeof to.path !== "string") throw new ApiError(400, "invalid_request", "Chemin manquant");
      target = assertInDrive(to.path.trim());
      if (to.overwrite) qs.set("overwrite", "true");
    }
    qs.set("path", target);
    const upstream = await instanceFetch(agentId, `/v1/files/content?${qs.toString()}`, { method: "PUT", headers: { "Content-Type": type }, body: bytes });
    await assertUpstreamOk(upstream, "uploads/complete", "Le fichier n’a pas pu être enregistré. Réessayez.", "save_error");
    const text = await upstream.text().catch(() => "");
    const entry = text ? (JSON.parse(text) as { path?: string }) : {};
    await backoffice.cancelUpload(token, id).catch(() => undefined);
    return json(to.kind === "chat" ? { path: entry.path } : entry, 201);
  } catch (e) {
    return handleError(e);
  }
}

export const maxDuration = 300;
