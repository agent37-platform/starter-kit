// A document over the host's 4.5 MB request limit, sent in parts of 3 MB (Leslie, 20/11: up to 25 MB, web and
// phone). The app's routes relay each part to the back office, which keeps them and puts the file back together;
// `finish` says where it then goes. Contract for the back office: docs/plans/envois-en-morceaux.md.
// No imports from the app: the phone uses the same steps, and the test runs it with a fake fetch.

export type UploadDestination =
  /** A chat attachment: written in the expert's « Pièces jointes », the path comes back. */
  | { kind: "chat"; agentId: string }
  /** A file of the expert's drive, at `path` (absolute, as the drive gives it). */
  | { kind: "drive"; agentId: string; path: string; overwrite?: boolean }
  /** A document of the company memory, in `unit` when given. */
  | { kind: "memory"; title: string; unit?: string | null }
  /** A new version of a deposited document. */
  | { kind: "memory-version"; item: string };

export interface PartsOptions {
  partBytes: number;
  signal?: AbortSignal;
  /** 0 to 1, after each part. */
  onProgress?: (done: number) => void;
  fetch?: typeof fetch;
  /** Headers on every call (the phone's `Authorization`). */
  headers?: Record<string, string>;
  /** Prefix of the app's address (the phone's server); empty in the browser. */
  base?: string;
}

/** A refusal, with the status the route gave (404: the back office does not take parts yet). */
export class PartsError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const RETRIES = 2;

async function errorOf(res: Response, fallback: string): Promise<PartsError> {
  let message = fallback;
  try {
    const data = (await res.json()) as { error?: { message?: string } };
    if (data?.error?.message) message = data.error.message;
  } catch {
    // Not JSON: the fallback says it.
  }
  return new PartsError(res.status, message);
}

/** Sends `file` in parts and returns what the back office answered once it is put back together. */
export async function sendInParts<T = Record<string, unknown>>(file: Blob & { name?: string }, to: UploadDestination, o: PartsOptions): Promise<T> {
  const f = o.fetch ?? fetch;
  const base = o.base ?? "";
  const json = { ...o.headers, "Content-Type": "application/json" };
  const total = Math.max(1, Math.ceil(file.size / o.partBytes));

  const start = await f(`${base}/api/uploads`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ name: file.name || "fichier", type: file.type || "application/octet-stream", size: file.size, parts: total }),
    signal: o.signal,
  });
  if (!start.ok) throw await errorOf(start, "L’envoi n’a pas pu commencer.");
  const { id } = (await start.json()) as { id: string };

  const cancel = () => f(`${base}/api/uploads/${encodeURIComponent(id)}`, { method: "DELETE", headers: o.headers }).catch(() => undefined);
  try {
    for (let n = 0; n < total; n++) {
      const part = file.slice(n * o.partBytes, Math.min(file.size, (n + 1) * o.partBytes));
      for (let attempt = 0; ; attempt++) {
        const res = await f(`${base}/api/uploads/${encodeURIComponent(id)}/parts/${n}`, {
          method: "POST",
          headers: { ...o.headers, "Content-Type": "application/octet-stream" },
          body: part,
          signal: o.signal,
        }).catch((e: unknown) => {
          if ((e as Error)?.name === "AbortError") throw e;
          return null;
        });
        if (res?.ok) break;
        // A network cut or a server hiccup is tried again; a refusal (too large, no right) is not.
        if (attempt >= RETRIES || (res && res.status < 500)) throw res ? await errorOf(res, "L’envoi a échoué.") : new PartsError(0, "La connexion a été coupée. Réessayez.");
      }
      o.onProgress?.((n + 1) / total);
    }
    const done = await f(`${base}/api/uploads/${encodeURIComponent(id)}/complete`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ to }),
      signal: o.signal,
    });
    if (!done.ok) throw await errorOf(done, "Le fichier n’a pas pu être enregistré.");
    return (await done.json()) as T;
  } catch (e) {
    void cancel();
    throw e;
  }
}
