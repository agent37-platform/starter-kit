// Exécute un lecteur Python sur l'instance et récupère son résultat.
// - Les paramètres sont passés au script en JSON encodé en base64 (`P`).
// - `emit(result)` compresse le résultat (zlib puis base64) et l'imprime s'il fait au plus `INLINE_LIMIT` ;
//   sinon il l'écrit dans un fichier temporaire (mkstemp, 0600), lu par morceaux, vérifié par SHA-256,
//   puis supprimé. Les fichiers temporaires de plus de `SPOOL_TTL_S` sont supprimés à chaque écriture.

import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

export interface ExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export type Exec = (command: string) => Promise<ExecResult>;

/** Taille maximale de sortie renvoyée par l'exec d'Agent37. */
export const EXEC_OUTPUT_LIMIT = 512 * 1024;
/** Taille maximale d'un résultat imprimé directement, et taille d'un morceau de fichier temporaire. */
export const INLINE_LIMIT = 384 * 1024;
/** Taille maximale d'un résultat accepté. */
export const MAX_RESULT_BYTES = 64 * 1024 * 1024;
/** Taille maximale du résultat une fois décompressé, en octets. */
export const MAX_JSON_BYTES = 256 * 1024 * 1024;
/** Âge au-delà duquel un fichier temporaire est supprimé. */
export const SPOOL_TTL_S = 600;
const SPOOL_PREFIX = "yelema-reader-";
const CHUNKS_AT_ONCE = 4;

export type ReaderFailure = "exec" | "exit" | "truncated" | "output" | "integrity" | "too_large";

/** Échec d'un lecteur : `reason` et `detail` pour les journaux. */
export class ReaderError extends Error {
  readonly reason: ReaderFailure;
  readonly detail: string;

  constructor(reason: ReaderFailure, detail = "") {
    super(`lecture sur l'instance : ${reason}${detail ? ` (${detail})` : ""}`);
    this.name = "ReaderError";
    this.reason = reason;
    this.detail = detail;
  }
}

const PRELUDE = String.raw`
import base64 as _b64, json as _json
P = _json.loads(_b64.b64decode("__PARAMS__").decode())

def emit(result):
    import hashlib, os, tempfile, time, zlib
    reader = P["_reader"]
    data = _b64.b64encode(zlib.compress(_json.dumps(result, separators=(",", ":")).encode(), 9))
    if len(data) <= reader["inlineLimit"]:
        print(_json.dumps({"inline": data.decode()}))
        return
    tmp = tempfile.gettempdir()
    for name in os.listdir(tmp):
        if name.startswith(reader["spoolPrefix"]):
            stale = os.path.join(tmp, name)
            try:
                if time.time() - os.path.getmtime(stale) > reader["spoolTtl"]:
                    os.remove(stale)
            except OSError:
                pass
    fd, path = tempfile.mkstemp(prefix=reader["spoolPrefix"], dir=tmp)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    print(_json.dumps({"spool": path, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}))
`;

// Lit un morceau d'un fichier temporaire, ou le supprime ; refuse tout autre chemin.
const SPOOL_SCRIPT = String.raw`
import os, sys, tempfile
path = os.path.realpath(P["path"])
if os.path.dirname(path) != os.path.realpath(tempfile.gettempdir()) or not os.path.basename(path).startswith(P["_reader"]["spoolPrefix"]):
    sys.exit(3)
if P.get("remove"):
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
else:
    with open(path, "rb") as f:
        f.seek(P["offset"])
        sys.stdout.write(f.read(P["length"]).decode("ascii"))
`;

export interface ReaderOptions {
  /** Remplace `INLINE_LIMIT`. */
  inlineLimit?: number;
}

/** Commande shell qui exécute `script` avec `P` et `emit` définis. */
export function pythonCommand(script: string, params: object = {}, opts: ReaderOptions = {}): string {
  const all = { ...params, _reader: { inlineLimit: opts.inlineLimit ?? INLINE_LIMIT, spoolPrefix: SPOOL_PREFIX, spoolTtl: SPOOL_TTL_S } };
  const prelude = PRELUDE.trim().replace("__PARAMS__", Buffer.from(JSON.stringify(all)).toString("base64"));
  return `echo '${Buffer.from(`${prelude}\n\n${script.trim()}\n`).toString("base64")}' | base64 -d | python3`;
}

async function run(exec: Exec, command: string): Promise<string> {
  let res: ExecResult;
  try {
    res = await exec(command);
  } catch (e) {
    throw new ReaderError("exec", e instanceof Error ? e.message : String(e));
  }
  if (res.exit_code !== 0) throw new ReaderError("exit", `code ${res.exit_code} ${res.stderr.slice(0, 300)}`);
  if (res.truncated) throw new ReaderError("truncated");
  return res.stdout;
}

type Envelope = { inline: string } | { spool: string; size: number; sha256: string };

function envelopeOf(stdout: string): Envelope {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(stdout.trim()) as Record<string, unknown>;
  } catch {
    throw new ReaderError("output", stdout.slice(0, 200));
  }
  if (typeof raw.inline === "string") return { inline: raw.inline };
  const { spool, size, sha256 } = raw;
  if (typeof spool === "string" && Number.isSafeInteger(size) && (size as number) > 0 && typeof sha256 === "string" && /^[0-9a-f]{64}$/.test(sha256)) {
    return { spool, size: size as number, sha256 };
  }
  throw new ReaderError("output", stdout.slice(0, 200));
}

async function inBatches<T>(tasks: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < tasks.length; i += size) out.push(...(await Promise.all(tasks.slice(i, i + size).map((t) => t()))));
  return out;
}

async function readSpool(exec: Exec, { spool, size, sha256 }: { spool: string; size: number; sha256: string }, chunk: number): Promise<string> {
  const spoolCommand = (params: object) => pythonCommand(SPOOL_SCRIPT, { path: spool, ...params });
  try {
    if (size > MAX_RESULT_BYTES) throw new ReaderError("too_large", `${size} octets`);
    const offsets = Array.from({ length: Math.ceil(size / chunk) }, (_, i) => i * chunk);
    const parts = await inBatches(
      offsets.map((offset) => async () => {
        const length = Math.min(chunk, size - offset);
        const part = await run(exec, spoolCommand({ offset, length }));
        if (part.length !== length) throw new ReaderError("integrity", `morceau ${offset} : ${part.length}/${length}`);
        return part;
      }),
      CHUNKS_AT_ONCE
    );
    const packed = parts.join("");
    if (createHash("sha256").update(packed).digest("hex") !== sha256) throw new ReaderError("integrity", "empreinte différente");
    return packed;
  } finally {
    await run(exec, spoolCommand({ remove: true })).catch(() => {});
  }
}

/** Exécute un lecteur et passe son résultat JSON à `parse` ; lève `ReaderError` si le résultat est absent ou incomplet. */
export async function runPythonReader<T>(exec: Exec, script: string, params: object, parse: (json: string) => T, opts: ReaderOptions = {}): Promise<T> {
  const envelope = envelopeOf(await run(exec, pythonCommand(script, params, opts)));
  const packed = "inline" in envelope ? envelope.inline : await readSpool(exec, envelope, opts.inlineLimit ?? INLINE_LIMIT);
  let json: string;
  try {
    json = inflateSync(Buffer.from(packed, "base64"), { maxOutputLength: MAX_JSON_BYTES }).toString("utf8");
  } catch (e) {
    if ((e as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE") throw new ReaderError("too_large", `plus de ${MAX_JSON_BYTES} octets décompressés`);
    throw new ReaderError("output", "résultat non décompressable");
  }
  return parse(json);
}
