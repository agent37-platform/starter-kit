import assert from "node:assert/strict";
import { test } from "node:test";
import { citedFolder, deliverableCount, docKind, drivePathsIn, FOLDER_BARE, FOLDER_CODE, isHiddenInChat, normDrivePath, noteFolder, openTarget, turnDocs } from "./drive-links.ts";

test("the paths a reply names, in order, once each, in one spelling", () => {
  const text = [
    "Voici le devis : `~/Livrables/Kouassi/Devis Yao.pdf`",
    "et le [tableau](file:///home/node/Livrables/Kouassi/pipeline.xlsx).",
    "Rappel : /home/node/Livrables/Kouassi/pipeline.xlsx",
    "[note](<sandbox:/home/node/Livrables/Kouassi/Note de visite.docx>)",
  ].join("\n");
  assert.deepEqual(drivePathsIn(text), ["~/Livrables/Kouassi/Devis Yao.pdf", "~/Livrables/Kouassi/pipeline.xlsx", "~/Livrables/Kouassi/Note de visite.docx"]);
  assert.equal(normDrivePath("/home/node/Livrables/A%20B.pdf"), "~/Livrables/A B.pdf");
});

test("a path written from the drive itself, without ~/, is a file too (Leslie, 28/10)", () => {
  const text = "Le détail est ici : Livrables/Djeneba/Reunions/2026-10-28_comptes-rendus.md.\nEt `Livrables/Djeneba/plan.xlsx`";
  assert.deepEqual(drivePathsIn(text), ["~/Livrables/Djeneba/Reunions/2026-10-28_comptes-rendus.md", "~/Livrables/Djeneba/plan.xlsx"]);
  assert.equal(normDrivePath("Livrables/A.pdf"), "~/Livrables/A.pdf");
  // A note gets no card, but its name opens its folder; memory stays unlinked.
  assert.equal(noteFolder("Livrables/Djeneba/Reunions/2026-10-28_comptes-rendus.md"), "~/Livrables/Djeneba/Reunions");
  assert.equal(noteFolder("~/Livrables/Koffi/_memoire/client.md"), null);
  assert.equal(noteFolder("~/Livrables/Koffi/deck.pdf"), null);
  // A folder stays a folder.
  assert.deepEqual(drivePathsIn("Dossier : Livrables/Fatima/tajplast/"), []);
});

test("formats", () => {
  assert.deepEqual(["a.PDF", "b.xlsx", "c.docx", "d.pptx", "e.png", "v.mp4", "s.mp3", "f.zip"].map(docKind), ["pdf", "excel", "word", "powerpoint", "image", "video", "audio", "other"]);
});

test("cards: the named files, then the deliverables this turn wrote, never another turn's nor the memory", () => {
  const listing = [
    { name: "Devis Yao.pdf", path: "/home/node/Livrables/Kouassi/Devis Yao.pdf", type: "file", size: 2048, modified: 100 },
    { name: "pipeline.xlsx", path: "/home/node/Livrables/Kouassi/pipeline.xlsx", type: "file", size: 4096, modified: 2_100 },
    { name: "telegram.pdf", path: "/home/node/Livrables/Kouassi/telegram.pdf", type: "file", size: 1, modified: 2_200 },
  ];
  const written = ["Livrables/Kouassi/pipeline.xlsx", "Livrables/Kouassi/Mémoire/notes.md", "Livrables/Kouassi/brouillon.md"];
  const docs = turnDocs("Le devis : `~/Livrables/Kouassi/Devis Yao.pdf`", listing, written);
  assert.deepEqual(
    docs.map((d) => [d.name, d.size, d.kind]),
    [
      ["Devis Yao.pdf", 2048, "pdf"],
      ["pipeline.xlsx", 4096, "excel"],
    ]
  );
  // A file written meanwhile by another conversation (Telegram) gets no card here.
  assert.ok(!docs.some((d) => d.name === "telegram.pdf"));
  // Without a listing, the named files alone.
  assert.deepEqual(turnDocs("`~/Livrables/X/a.pdf`", []).map((d) => d.path), ["~/Livrables/X/a.pdf"]);
});

test("cards: a named file missing from a listed folder is made up, elsewhere it is kept", () => {
  const listing = [{ name: "Devis.pdf", path: "/home/node/Livrables/Kouassi/Devis.pdf", type: "file", size: 10, modified: 1 }];
  const text = "`~/Livrables/Kouassi/Inventé.pdf` et `~/Livrables/Archives/2025/export.pdf`";
  assert.deepEqual(turnDocs(text, listing).map((d) => d.path), ["~/Livrables/Archives/2025/export.pdf"]);
});

test("turnDocs shows no card for a working file (JSON, script, log)", () => {
  const listing = [
    { path: "Livrables/Kouassi/etat.json", type: "file" as const, hidden: false, modified: 50, size: 10, name: "etat.json" },
    { path: "Livrables/Kouassi/calcul.py", type: "file" as const, hidden: false, modified: 50, size: 10, name: "calcul.py" },
    { path: "Livrables/Kouassi/Point.pdf", type: "file" as const, hidden: false, modified: 50, size: 10, name: "Point.pdf" },
  ];
  const docs = turnDocs("Voir Livrables/Kouassi/etat.json", listing as never, ["Livrables/Kouassi/calcul.py", "Livrables/Kouassi/Point.pdf"]);
  assert.deepEqual(docs.map((d) => d.name), ["Point.pdf"]);
});

test("a note (.md) or a memory file named in the reply or by a MEDIA tag gets no card", () => {
  const text = "Voir `~/Livrables/Koffi/brief.md` et `~/Livrables/Koffi/_memoire/client.pdf`, puis `~/Livrables/Koffi/affiche.png`.";
  const docs = turnDocs(text, [], ["~/Livrables/Koffi/notes.md", "~/Livrables/Koffi/Mémoire/suivi.docx", "~/Livrables/Koffi/deck.pdf"]);
  assert.deepEqual(docs.map((d) => d.name), ["affiche.png", "deck.pdf"]);
  assert.ok(isHiddenInChat("~/Livrables/Koffi/brief.MD") && !isHiddenInChat("~/Livrables/Koffi/deck.pdf"));
  assert.ok(isHiddenInChat("~/Livrables/Koffi/compte-rendu.txt") && isHiddenInChat("Livrables/Koffi/notes.TXT"));
});

test("a folder the Expert cites, in backticks or bare with its slash", () => {
  const text = "Dossier local : `Livrables/Fatima/tajplast/flyers-modernes/`\nAussi ~/Livrables/Koffi/stand/ et `~/Livrables/Pièces jointes` ici.";
  const code = [...text.matchAll(FOLDER_CODE)].map((m) => citedFolder(m[1]));
  assert.deepEqual(code, ["~/Livrables/Fatima/tajplast/flyers-modernes", "~/Livrables/Pièces jointes"]);
  const bare = [...text.matchAll(FOLDER_BARE)].map((m) => citedFolder(m[2]));
  assert.deepEqual(bare, ["~/Livrables/Koffi/stand"]);
});

test("a file, or a memory folder, is not a folder link", () => {
  assert.equal(citedFolder("~/Livrables/Fatima/post.docx"), null);
  assert.equal(citedFolder("/home/node/Livrables/Fatima/_memoire/"), null);
  assert.equal(citedFolder("/home/node/Livrables/Fatima/"), "~/Livrables/Fatima");
});

test("openTarget: an address of /livrables/ouvrir names a drive file or folder, nothing else", () => {
  assert.deepEqual(openTarget("https://unifood.app.yelema.ai/livrables/ouvrir?p=Livrables%2FFatima%2Fplan.pdf"), { path: "~/Livrables/Fatima/plan.pdf", file: true });
  assert.deepEqual(openTarget("/livrables/ouvrir?p=~/Livrables/Fatima/campagne"), { path: "~/Livrables/Fatima/campagne", file: false });
  assert.equal(openTarget("https://x.app.yelema.ai/livrables/ouvrir?p=Livrables/../.hermes/a.txt"), null);
  assert.equal(openTarget("https://x.app.yelema.ai/livrables/ouvrir?p=/home/node/.hermes/a.txt"), null);
  assert.equal(openTarget("https://example.com/autre?p=Livrables/a.pdf"), null);
});

test("drivePathsIn: a deliverable given as an app address is a cited file", () => {
  const text = "Voici le devis : https://unifood.app.yelema.ai/livrables/ouvrir?p=Livrables%2FKouassi%2Fdevis_v2.xlsx et le dossier https://unifood.app.yelema.ai/livrables/ouvrir?p=Livrables%2FKouassi";
  assert.deepEqual(drivePathsIn(text), ["~/Livrables/Kouassi/devis_v2.xlsx"]);
});

test("an Expert's deliverables: its own finished files only", () => {
  const f = (path: string, type = "file") => ({ path, type });
  const entries = [
    f("/home/node/Livrables/Fatou/Contrat.docx"),
    f("/home/node/Livrables/Fatou/Paie/Octobre.xlsx"),
    f("/home/node/Livrables/Fatou/Paie", "directory"),
    f("/home/node/Livrables/Fatou/notes.md"),
    f("/home/node/Livrables/Fatou/_memoire/jour-zero.json"),
    f("/home/node/Livrables/Fatou/Reçus/cv.pdf"),
    f("/home/node/Livrables/Fatima/Post.pdf"),
  ];
  assert.equal(deliverableCount(entries, "/home/node/Livrables/Fatou"), 2);
});
