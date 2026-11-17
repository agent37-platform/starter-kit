import { instanceFetch } from "@/lib/agent37";
import { requireAgentAccess } from "@/lib/auth";
import { assertInDrive } from "@/lib/drive";
import { ApiError, handleError, json } from "@/lib/http";
import { assertUpstreamOk, requireTrimmed } from "../../_helpers";

type Ctx = { params: Promise<{ id: string }> };

// Content types a browser shows without running anything from the file. SVG is an image that
// carries script, so it is not one of them.
const DOWNLOAD_FAILED = "Le fichier n’a pas pu être téléchargé. Réessayez.";
const INERT_TYPE = /^(image\/(png|jpeg|gif|webp|bmp|avif|x-icon|vnd\.microsoft\.icon)|application\/pdf|audio\/|video\/|text\/plain)\b/i;

// Stream a file's bytes back to the browser (preview/download). This is the URL <img>/<iframe>/<a>
// point at, so we pass the upstream Content-Type and Content-Disposition straight through —
// `disposition=inline` lets the browser render, `attachment` (the Agents API default) downloads.
// `nosniff` keeps the browser from second-guessing the extension-derived type. The byte stream is
// piped without buffering so any size works.
//
// A file is whatever an expert or a member put in the drive, and this URL can be opened directly,
// outside the preview's sandboxed <iframe>. So anything but a picture, a PDF, audio, video or plain
// text is answered with `Content-Security-Policy: sandbox`: an HTML or SVG file opened by its link
// then runs in an origin of its own, without the member's session.
//
// A Range header is forwarded; the instance's status (200, 206, 416) and its Content-Range and
// Accept-Ranges come back as they are.
export async function GET(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await requireAgentAccess(id);

    const { searchParams } = new URL(request.url);
    const qs = new URLSearchParams();
    const path = assertInDrive(requireTrimmed(searchParams.get("path"), "Chemin manquant"));
    const disposition = searchParams.get("disposition");
    // `v` (the file's mtime) names the version: that answer cannot change, the browser keeps it.
    const versioned = /^\d{1,15}$/.test(searchParams.get("v") ?? "");
    qs.set("path", path);
    if (disposition) qs.set("disposition", disposition);

    const reqHeaders: Record<string, string> = {};
    const range = request.headers.get("range");
    if (range) reqHeaders["Range"] = range;

    const upstream = await instanceFetch(id, `/v1/files/content?${qs.toString()}`, {
      headers: reqHeaders,
    });

    if (upstream.status === 416) {
      const unsatisfied = new Headers({ "Cache-Control": "no-store" });
      const size = upstream.headers.get("Content-Range");
      if (size) unsatisfied.set("Content-Range", size);
      return new Response(null, { status: 416, headers: unsatisfied });
    }
    await assertUpstreamOk(upstream, "files/content", DOWNLOAD_FAILED, "download_error");
    if (!upstream.body) throw new ApiError(502, "download_error", DOWNLOAD_FAILED);

    const headers = new Headers();
    const ct = upstream.headers.get("Content-Type");
    if (ct) headers.set("Content-Type", ct);
    const cd = upstream.headers.get("Content-Disposition");
    if (cd) headers.set("Content-Disposition", cd);
    const cl = upstream.headers.get("Content-Length");
    if (cl) headers.set("Content-Length", cl);
    const cr = upstream.headers.get("Content-Range");
    if (cr) headers.set("Content-Range", cr);
    const ar = upstream.headers.get("Accept-Ranges");
    if (ar) headers.set("Accept-Ranges", ar);
    headers.set("Cache-Control", versioned ? "private, max-age=86400, immutable" : "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    if (!INERT_TYPE.test(ct ?? "")) headers.set("Content-Security-Policy", "sandbox");

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (e) {
    return handleError(e);
  }
}

// Write raw bytes to a path (create / overwrite / upload). The request body is forwarded to the
// Agents API PUT /v1/files/content; `overwrite` and the optional X-Expected-Mtime (epoch ms,
// optimistic-concurrency) header pass through. Returns the resolved FileEntry. The upstream HTTP
// status is preserved, so overwrite=false collisions (409) and stale-mtime writes (412) reach the
// client with the right status. instanceFetch buffers the streamed body to a known length so the
// instance-host proxy frames it correctly (it drops chunked request bodies — see instanceFetch).
export async function PUT(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await requireAgentAccess(id);

    const { searchParams } = new URL(request.url);
    const path = assertInDrive(requireTrimmed(searchParams.get("path"), "Chemin manquant"));
    const qs = new URLSearchParams();
    qs.set("path", path);
    const overwrite = searchParams.get("overwrite");
    if (overwrite != null) qs.set("overwrite", overwrite);

    const headers: Record<string, string> = {};
    const ct = request.headers.get("Content-Type");
    if (ct) headers["Content-Type"] = ct;
    const mtime = request.headers.get("X-Expected-Mtime");
    if (mtime) headers["X-Expected-Mtime"] = mtime;

    const upstream = await instanceFetch(id, `/v1/files/content?${qs.toString()}`, {
      method: "PUT",
      headers,
      body: request.body,
    });

    await assertUpstreamOk(upstream, "files/content", "Le fichier n’a pas pu être enregistré. Réessayez.", "save_error");
    const text = await upstream.text().catch(() => "");
    return json(text ? JSON.parse(text) : {});
  } catch (e) {
    return handleError(e);
  }
}

// Uploads (and large downloads) can take a while; allow a generous ceiling like the chat routes.
export const maxDuration = 300;
