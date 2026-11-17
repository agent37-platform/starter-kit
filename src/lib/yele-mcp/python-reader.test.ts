import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { type Exec, type ExecResult, ReaderError, pythonCommand, runPythonReader } from "./python-reader.ts";

const ok = (stdout: string): ExecResult => ({ exit_code: 0, stdout, stderr: "", truncated: false });
const packedOf = (value: unknown) => deflateSync(JSON.stringify(value)).toString("base64");

/** The parameters a command carries (its script is base64; `P` is base64 JSON inside it). */
function paramsOf(command: string): Record<string, unknown> {
  const script = Buffer.from(/^echo '([^']+)'/.exec(command)![1], "base64").toString("utf8");
  return JSON.parse(Buffer.from(/b64decode\("([^"]+)"\)/.exec(script)![1], "base64").toString("utf8"));
}

/** An instance whose reader spooled `packed`: answers the chunk reads, records the removal. */
function spoolingInstance(packed: string, opts: { sha256?: string; corrupt?: boolean } = {}) {
  const calls = { chunks: 0, removed: false };
  const exec: Exec = async (command) => {
    const p = paramsOf(command);
    if (p.path === undefined) {
      return ok(JSON.stringify({ spool: "/tmp/yelema-reader-abc", size: packed.length, sha256: opts.sha256 ?? createHash("sha256").update(packed).digest("hex") }));
    }
    if (p.remove) {
      calls.removed = true;
      return ok("");
    }
    calls.chunks++;
    const part = packed.slice(p.offset as number, (p.offset as number) + (p.length as number));
    return ok(opts.corrupt ? part.slice(1) : part);
  };
  return { exec, calls };
}

test("pythonCommand : les paramètres voyagent en base64 dans le script, jamais dans le shell", () => {
  const cmd = pythonCommand("emit(P['q'])", { q: "'; rm -rf / #" });
  assert.match(cmd, /^echo '[A-Za-z0-9+/=]+' \| base64 -d \| python3$/);
  assert.equal(paramsOf(cmd).q, "'; rm -rf / #");
});

test("runPythonReader : un petit résultat revient dans la sortie", async () => {
  const value = { rows: [[1, 2, 3]] };
  const out = await runPythonReader(async () => ok(`${JSON.stringify({ inline: packedOf(value) })}\n`), "emit(1)", {}, JSON.parse);
  assert.deepEqual(out, value);
});

test("runPythonReader : un gros résultat passe par le fichier tampon, lu par morceaux, vérifié puis supprimé", async () => {
  const value = { rows: Array.from({ length: 400 }, (_, i) => [`ligne-${i}`, i * 7]) };
  const packed = packedOf(value);
  const { exec, calls } = spoolingInstance(packed);
  const out = await runPythonReader(exec, "emit(1)", {}, JSON.parse, { inlineLimit: 100 });
  assert.deepEqual(out, value);
  assert.equal(calls.chunks, Math.ceil(packed.length / 100));
  assert.equal(calls.removed, true);
});

test("runPythonReader : empreinte différente ou morceau incomplet, rien n'est rendu et le fichier est supprimé", async () => {
  const packed = packedOf({ a: "x".repeat(500) });
  const bad = spoolingInstance(packed, { sha256: "0".repeat(64) });
  await assert.rejects(runPythonReader(bad.exec, "emit(1)", {}, JSON.parse, { inlineLimit: 50 }), (e: unknown) => e instanceof ReaderError && e.reason === "integrity");
  assert.equal(bad.calls.removed, true);
  const cut = spoolingInstance(packed, { corrupt: true });
  await assert.rejects(runPythonReader(cut.exec, "emit(1)", {}, JSON.parse, { inlineLimit: 50 }), (e: unknown) => e instanceof ReaderError && e.reason === "integrity");
  assert.equal(cut.calls.removed, true);
});

test("runPythonReader : échec, sortie tronquée, code d'erreur ou sortie inattendue sont des erreurs, jamais « rien »", async () => {
  const reason = (r: string) => (e: unknown) => e instanceof ReaderError && e.reason === r;
  await assert.rejects(runPythonReader(async () => Promise.reject(new Error("réseau")), "", {}, JSON.parse), reason("exec"));
  await assert.rejects(runPythonReader(async () => ({ ...ok(""), truncated: true }), "", {}, JSON.parse), reason("truncated"));
  await assert.rejects(runPythonReader(async () => ({ ...ok(""), exit_code: 1, stderr: "Traceback" }), "", {}, JSON.parse), reason("exit"));
  await assert.rejects(runPythonReader(async () => ok("pas du json"), "", {}, JSON.parse), reason("output"));
  await assert.rejects(runPythonReader(async () => ok(JSON.stringify({ inline: "%%%" })), "", {}, JSON.parse), reason("output"));
  await assert.rejects(runPythonReader(async () => ok(JSON.stringify({ spool: "/tmp/x", size: -1, sha256: "z" })), "", {}, JSON.parse), reason("output"));
});

test("runPythonReader : un résultat trop gros est refusé sans être lu, et son fichier supprimé", async () => {
  let removed = false;
  const exec: Exec = async (command) => {
    const p = paramsOf(command);
    if (p.remove) removed = true;
    return ok(p.path === undefined ? JSON.stringify({ spool: "/tmp/yelema-reader-big", size: 1e9, sha256: "a".repeat(64) }) : "");
  };
  await assert.rejects(runPythonReader(exec, "", {}, JSON.parse), (e: unknown) => e instanceof ReaderError && e.reason === "too_large");
  assert.equal(removed, true);
});

const hasPython = (() => {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const localExec: Exec = (command) =>
  new Promise((resolve) => {
    execFile("bash", ["-c", command], { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ exit_code: error ? Number((error as { code?: number }).code ?? 1) : 0, stdout, stderr, truncated: false });
    });
  });

const spoolFiles = () => readdirSync(tmpdir()).filter((n) => n.startsWith("yelema-reader-"));

test("de bout en bout avec python3 : direct, par fichier tampon, puis plus aucun fichier laissé", { skip: !hasPython }, async () => {
  const before = spoolFiles().length;
  const script = 'emit({"echo": P["word"], "rows": [[i, "x" * 20] for i in range(2000)]})';
  const small = await runPythonReader(localExec, script, { word: "é" }, JSON.parse);
  const spooled = await runPythonReader(localExec, script, { word: "é" }, JSON.parse, { inlineLimit: 1000 });
  assert.equal(small.echo, "é");
  assert.deepEqual(spooled, small);
  assert.equal(spoolFiles().length, before);
});

test("de bout en bout avec python3 : un chemin hors des fichiers tampons est refusé", { skip: !hasPython }, async () => {
  const exec: Exec = async (command) => {
    if (paramsOf(command).path === undefined) return ok(JSON.stringify({ spool: "/etc/passwd", size: 10, sha256: "a".repeat(64) }));
    return localExec(command);
  };
  await assert.rejects(runPythonReader(exec, "", {}, JSON.parse), (e: unknown) => e instanceof ReaderError && e.reason === "exit");
});
