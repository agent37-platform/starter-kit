import assert from "node:assert/strict";
import { test } from "node:test";
import { isArchived, newerVersions, splitVersions, versionOf } from "./drive-versions.ts";

const f = (name: string) => ({ name, type: "file" });

test("the version number is read from the end of the name", () => {
  assert.deepEqual(versionOf("261101_tajplast_devis-simple_v18.pdf"), { key: "261101_tajplast_devis-simple.pdf", n: 18 });
  assert.deepEqual(versionOf("Rapport-V3.docx"), { key: "rapport.docx", n: 3 });
  assert.equal(versionOf("devis.pdf"), null);
  assert.equal(versionOf("v2.pdf"), null);
});

test("only the latest version of each document stays, compared as numbers", () => {
  const entries = [f("devis_v9.pdf"), f("devis_v10.pdf"), f("devis_v2.pdf"), f("note.pdf"), { name: "Sources_v1", type: "directory" }];
  const { current, older } = splitVersions(entries);
  assert.deepEqual(current.map((e) => e.name), ["devis_v10.pdf", "note.pdf", "Sources_v1"]);
  assert.deepEqual(older.map((e) => e.name), ["devis_v9.pdf", "devis_v2.pdf"]);
});

test("formats and documents are kept apart, and a lone version is not folded", () => {
  const entries = [f("devis_v2.pdf"), f("devis_v2.html"), f("devis_v1.pdf"), f("offre_v4.pdf")];
  const { current, older } = splitVersions(entries);
  assert.deepEqual(current.map((e) => e.name), ["devis_v2.pdf", "devis_v2.html", "offre_v4.pdf"]);
  assert.deepEqual(older.map((e) => e.name), ["devis_v1.pdf"]);
});

test("Garder une ancienne version : les plus récentes du même document seulement", () => {
  const entries = [{ name: "post_v1.png" }, { name: "post_v2.png" }, { name: "post_v3.png" }, { name: "devis_v4.pdf" }, { name: "post_v9", type: "directory" }];
  assert.deepEqual(newerVersions("post_v1.png", entries).map((e) => e.name), ["post_v2.png", "post_v3.png"]);
  assert.deepEqual(newerVersions("post_v3.png", entries), []);
  assert.deepEqual(newerVersions("post.png", entries), []);
});

test("ce qui est dans Archivées", () => {
  assert.equal(isArchived("/home/drive/Fatima/Offre/Archivées/post_v1.png"), true);
  assert.equal(isArchived("/home/drive/Fatima/Offre/Archivées"), true);
  assert.equal(isArchived("/home/drive/Fatima/Offre/post_v1.png"), false);
});
