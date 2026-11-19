import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import type { DriveTree } from "./drive-paths.ts";
import { deliverablesFromTree, expertOfFolder, insideLivrables, relativeOf } from "./deliverables-shape.ts";

const ABS = "/home/node/Livrables";
type E = DriveTree["entries"][number];
const dir = (path: string, depth: number): E => ({ name: path.split("/").at(-1)!, path: `${ABS}/${path}`, type: "directory", size: null, modified: 1_761_000_000, hidden: false, depth });
const file = (path: string, depth: number, modified = 1_761_000_000): E => ({ name: path.split("/").at(-1)!, path: `${ABS}/${path}`, type: "file", size: 10, modified, hidden: false, depth });
const tree = (entries: E[], complete = true): DriveTree => ({ entries, complete });
const link = (p: string) => `https://acme.app.yelema.ai/l?p=${encodeURIComponent(p)}`;

// Same cases as the back office's modules/app-api/deliverables.test.ts: the two lists must match item for item.
describe("livrables du mobile, depuis l'arbre", () => {
  it("un fichier par dossier d'expert, du plus récent au plus ancien ; cachés, _mémoire, travail et racine nue ignorés", () => {
    const items = deliverablesFromTree(
      tree([
        dir("Kouassi", 0), dir("_memoire", 0), dir(".cache", 0), file("perdu.pdf", 0),
        file("_memoire/x.pdf", 1), file(".cache/y.pdf", 1),
        file("Kouassi/Relance.docx", 1, 1_761_100_000), dir("Kouassi/Tableau-de-bord", 1), dir("Kouassi/Mémoire", 1), file("Kouassi/.secret", 1),
        file("Kouassi/notes-de-travail.md", 1), file("Kouassi/Brouillon.MD", 1), file("Kouassi/voix.srt", 1), file("Kouassi/calcul.py", 1), file("Kouassi/etat.json", 1),
        file("Kouassi/Mémoire/client.pdf", 2), file("Kouassi/Tableau-de-bord/ventes.xlsx", 2, 1_761_200_000),
      ]),
      { profiles: ["kouassi"], only: null, link }
    );
    assert.deepEqual(items.map((i) => [i.expertId, i.title, i.kind, i.folder]), [["kouassi", "ventes.xlsx", "xlsx", "Tableau-de-bord"], ["kouassi", "Relance.docx", "docx", ""]]);
    // The back office's id: same "Nouveau" and "déjà ouvert" on the phone whichever answered.
    assert.equal(items[0].id, createHash("sha256").update("Livrables/Kouassi/Tableau-de-bord/ventes.xlsx").digest("hex").slice(0, 16));
    assert.equal(items[0].updatedAt, new Date(1_761_200_000_000).toISOString());
    assert.equal(items[0].url, link("Livrables/Kouassi/Tableau-de-bord/ventes.xlsx"));
  });

  it("siège : seul son dossier, attribué au siège, sous-dossier relatif", () => {
    const items = deliverablesFromTree(tree([dir("Autre", 0), file("Autre/a.pdf", 1), dir("u-abc123", 0), file("u-abc123/b.pdf", 1), dir("u-abc123/Q4", 1), file("u-abc123/Q4/c.pdf", 2)]), { profiles: [], only: "u-abc123", link });
    assert.deepEqual(items.map((i) => [i.expertId, i.title, i.folder]).sort(), [["u-abc123", "b.pdf", ""], ["u-abc123", "c.pdf", "Q4"]]);
  });

  it("compte rendu rangé par date, un niveau plus bas (Djénéba, Réunions/<date>/)", () => {
    const items = deliverablesFromTree(
      tree([dir("Djénéba", 0), dir("Djénéba/Réunions", 1), dir("Djénéba/Réunions/2026-11-19", 2), file("Djénéba/Réunions/2026-11-19/CR-Unifood.pdf", 3)]),
      { profiles: ["unifood__djeneba"], only: null, link }
    );
    assert.deepEqual(items.map((i) => [i.expertId, i.title, i.folder]), [["djeneba", "CR-Unifood.pdf", "Réunions/2026-11-19"]]);
  });

  it("dossier d'expert : accents et majuscules repliés, clé du catalogue (profil d'une copie compris)", () => {
    assert.equal(expertOfFolder("Djénéba", ["djeneba"]), "djeneba");
    assert.equal(expertOfFolder("Inconnu", ["djeneba"]), "inconnu");
    assert.equal(expertOfFolder("koffi", ["u-abc123__koffi"]), "koffi");
  });

  it("chemins : relatif à Livrables, lien seulement à l'intérieur", () => {
    assert.equal(relativeOf("/home/node/Livrables/A/b.pdf"), "Livrables/A/b.pdf");
    assert.equal(relativeOf("~/Livrables/A/b.pdf"), "Livrables/A/b.pdf");
    assert.equal(relativeOf("/home/node/.ssh/id"), null);
    assert.ok(insideLivrables("Livrables/A/b.pdf"));
    for (const bad of ["Livrables/b.pdf", "Livrables/_memoire/x", "Livrables/../.ssh/id", "Livrables/A/.env", "memory/USER.md", "Livrables//x"]) assert.ok(!insideLivrables(bad), bad);
  });
});
