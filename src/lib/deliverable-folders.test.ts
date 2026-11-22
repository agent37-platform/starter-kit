import { test } from "node:test";
import assert from "node:assert/strict";
import { deliverableItems, type TreeEntry } from "./deliverable-folders.ts";

const R = "/home/node/Livrables";
const d = (path: string, depth: number, modified = 0): TreeEntry => ({ name: path.split("/").pop()!, path: `${R}/${path}`, type: "directory", modified, depth });
const f = (path: string, depth: number, modified = 0): TreeEntry => ({ name: path.split("/").pop()!, path: `${R}/${path}`, type: "file", modified, depth });

test("one row per subject, newest first, with its owner, files and cover", () => {
  const items = deliverableItems([
    d("Fatima", 0),
    d("Koffi", 0),
    d("Fatima/Newsletter", 1, 10),
    f("Fatima/Newsletter/newsletter.pdf", 2, 50),
    f("Fatima/Newsletter/notes.md", 2, 90),
    d("Koffi/Flyers", 1, 20),
    f("Koffi/Flyers/flyer.png", 2, 30),
    f("Koffi/Flyers/flyer.pdf", 2, 40),
    f("Koffi/charte.pdf", 1, 5),
  ]);
  assert.deepEqual(
    items.map((i) => [i.name, i.owner, i.files, i.modified]),
    [
      ["Newsletter", "Fatima", 1, 50],
      ["Flyers", "Koffi", 2, 40],
      ["charte.pdf", "Koffi", 1, 5],
    ]
  );
  assert.equal(items[1].cover, `${R}/Koffi/Flyers/flyer.png`); // the picture, though the PDF is newer
  assert.equal(items[2].cover, `${R}/Koffi/charte.pdf`);
  // The cover's own date, not the folder's: a new file beside it does not fetch its preview again.
  assert.equal(items[1].coverModified, 30);
  assert.equal(items[2].coverModified, 5);
});

test("a file deeper than its subject folder counts there; a folder deeper still does not make a subject", () => {
  const items = deliverableItems([d("Fatima", 0), d("Fatima/Plan", 1, 1), d("Fatima/Plan/v2", 2, 1), f("Fatima/Plan/v2/a.png", 3, 7), f("Fatima/Plan/b.pdf", 2, 9)]);
  assert.deepEqual(items.map((i) => [i.name, i.files, i.modified, i.cover]), [["Plan", 2, 9, `${R}/Fatima/Plan/v2/a.png`]]);
  assert.equal(items[0].coverModified, 7);
});

test("what the member brought, the memory and working files are no deliverables", () => {
  const items = deliverableItems([
    d("Fatima", 0),
    d("Fatima/Reçus", 1, 99),
    d("Fatima/_memoire", 1, 99),
    f("Fatima/script.py", 1, 99),
    d("Pièces jointes", 0),
    f("Pièces jointes/devis.pdf", 1, 99),
    d("Fatima/Plan", 1, 1),
    d("Fatima/Plan/source", 2, 1),
    f("Fatima/Plan/plan.docx", 2, 3),
  ]);
  assert.deepEqual(items.map((i) => i.name), ["Plan"]);
  assert.equal(items[0].files, 1);
});

test("a document shows itself when nothing better is there: slides before pages before sheets", () => {
  const items = deliverableItems([d("Fatima", 0), d("Fatima/Bilan", 1), f("Fatima/Bilan/chiffres.xlsx", 2, 3), f("Fatima/Bilan/deck.pptx", 2, 2), f("Fatima/note.docx", 1, 4)]);
  assert.equal(items.find((i) => i.name === "Bilan")?.cover, `${R}/Fatima/Bilan/deck.pptx`);
  assert.equal(items.find((i) => i.name === "note.docx")?.cover, `${R}/Fatima/note.docx`);
});

test("a folder's glimpse: its best cover anywhere inside, else its newest three entries, working files left out", async () => {
  const { folderPeeks } = await import("./deliverable-folders.ts");
  const e = (path: string, modified: number, type = "file") => ({ name: path.split("/").pop()!, path, type, modified, depth: path.split("/").length - 3 });
  const peeks = folderPeeks(
    [
      e("~/Livrables/Djeneba/Reunions", 9, "directory"),
      e("~/Livrables/Djeneba/Reunions/261120-090116", 9, "directory"),
      e("~/Livrables/Djeneba/Reunions/261120-090116/compte-rendu.html", 9),
      e("~/Livrables/Djeneba/Reunions/261120-090116/compte-rendu.json", 9),
      e("~/Livrables/Djeneba/Reunions/261119-140000", 5, "directory"),
      e("~/Livrables/Djeneba/Reunions/notes.md", 8),
      e("~/Livrables/Djeneba/Reunions/Ordre du jour.docx", 7),
      e("~/Livrables/Djeneba/Reunions/Plan.pdf", 6),
      e("~/Livrables/Djeneba/CFAO", 4, "directory"),
      e("~/Livrables/Djeneba/CFAO/Offre/visuel.png", 4),
      e("~/Livrables/Djeneba/CFAO/Recus/scan.png", 9),
    ],
    ["~/Livrables/Djeneba/Reunions", "~/Livrables/Djeneba/CFAO"]
  );
  const r = peeks.get("~/Livrables/Djeneba/Reunions")!;
  assert.equal(r.cover, "~/Livrables/Djeneba/Reunions/Plan.pdf");
  assert.deepEqual(r.first.map((x) => x.name), ["261120-090116", "Ordre du jour.docx", "Plan.pdf"]);
  assert.equal(r.count, 4);
  assert.equal(peeks.get("~/Livrables/Djeneba/CFAO")!.cover, "~/Livrables/Djeneba/CFAO/Offre/visuel.png");
});
