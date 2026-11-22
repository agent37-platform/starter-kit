import assert from "node:assert/strict";
import { test } from "node:test";
import { treeLoader, type TreeSource } from "./drive-tree.ts";
import type { DriveTree } from "./drive-paths.ts";
import type { FileEntry } from "./types.ts";

const dir = (path: string): FileEntry => ({ name: path.split("/").pop()!, path, type: "directory", size: null, modified: 0, hidden: false });
const file = (path: string): FileEntry => ({ ...dir(path), type: "file", size: 1 });
const notFound = () => Object.assign(new Error("not found"), { status: 404 });

function drive(tree: TreeSource["tree"]) {
  const calls: string[] = [];
  const disk: Record<string, FileEntry[]> = {
    "~/Livrables": [dir("~/Livrables/Awa"), file("~/Livrables/note.md")],
    "~/Livrables/Awa": [dir("~/Livrables/Awa/Bilan")],
    "~/Livrables/Awa/Bilan": [file("~/Livrables/Awa/Bilan/bilan.pdf")],
  };
  const src: TreeSource = {
    tree: (root, depth) => (calls.push(`tree ${root} ${depth}`), tree(root, depth)),
    list: async (path) => (calls.push(`list ${path}`), disk[path] ?? []),
    makeDir: async () => undefined,
  };
  return { src, calls };
}

test("la passerelle sait parcourir le dossier : une seule requête, sa réponse telle quelle", async () => {
  const answer: DriveTree = { entries: [{ ...file("~/Livrables/a.pdf"), depth: 0 }], complete: true };
  const { src, calls } = drive(async () => answer);
  assert.equal(await treeLoader()(src), answer);
  assert.deepEqual(calls, ["tree ~/Livrables 3"]);
});

test("passerelle pas encore à jour (404) : l'application parcourt elle-même, et ne redemande qu'après quelques minutes", async () => {
  let clock = 0;
  const load = treeLoader(() => clock);
  const { src, calls } = drive(async () => Promise.reject(notFound()));
  const tree = await load(src);
  assert.deepEqual(tree.entries.map((e) => [e.path, e.depth]), [
    ["~/Livrables/Awa", 0],
    ["~/Livrables/note.md", 0],
    ["~/Livrables/Awa/Bilan", 1],
    ["~/Livrables/Awa/Bilan/bilan.pdf", 2],
  ]);
  assert.equal(tree.complete, true);
  calls.length = 0;
  await load(src);
  assert.ok(!calls.some((c) => c.startsWith("tree")), "le 404 est retenu");
  clock += 5 * 60_000;
  calls.length = 0;
  await load(src);
  assert.equal(calls[0], "tree ~/Livrables 3");
});

test("une autre erreur de la passerelle n'est pas masquée par le parcours", async () => {
  const { src, calls } = drive(async () => Promise.reject(Object.assign(new Error("down"), { status: 502 })));
  await assert.rejects(treeLoader()(src), /down/);
  assert.deepEqual(calls, ["tree ~/Livrables 3"]);
});
