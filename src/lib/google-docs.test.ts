import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, dayHeading, docName, googleDocs, googleDocOf, isUnnamed, usedTime, usedGoogleDocs, parseShortcut, shortcutKind, shortcutTitle, titleFromLabel, withoutGoogleActions } from "./google-docs.ts";

const SHEET = "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/edit#gid=0";
const DOC = "https://docs.google.com/document/d/1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210zyxw/edit?usp=sharing";

test("a Google url gives its document, whatever its tail", () => {
  assert.deepEqual(googleDocOf(SHEET), { id: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd", kind: "sheets", url: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/edit" });
  assert.equal(googleDocOf(DOC)?.kind, "docs");
  assert.equal(googleDocOf("https://drive.google.com/file/d/abc/view"), null);
});

test("a link's label gives the title", () => {
  assert.equal(titleFromLabel("Ouvrir le suivi des candidatures"), "Suivi des candidatures");
  assert.equal(titleFromLabel("**Ouvrir la fiche de poste BDM**"), "Fiche de poste BDM");
  assert.equal(titleFromLabel("Ouvrir l’agenda"), "Agenda");
  assert.equal(titleFromLabel("Google Sheet"), null);
  assert.equal(titleFromLabel("ici"), null);
});

test("each document of a reply once, titled by its best link", () => {
  const text = `📊 Le suivi est prêt : ${SHEET}\n\n🔗 [Ouvrir le suivi des candidatures](${SHEET})\n🔗 [Ouvrir la fiche de poste BDM](${DOC})`;
  assert.deepEqual(googleDocs(text).map((d) => [d.kind, d.title]), [["sheets", "Suivi des candidatures"], ["docs", "Fiche de poste BDM"]]);
  assert.deepEqual(googleDocs(`Le tableau : ${SHEET}`).map((d) => d.title), ["Google Sheets"]);
  assert.deepEqual(googleDocs("Rien ici."), []);
});

test("the « Ouvrir » line to a Google document goes, the rest stays", () => {
  assert.equal(withoutGoogleActions(`✅ C'est prêt.\n\n🔗 [Ouvrir le suivi](${SHEET})`), "✅ C'est prêt.");
  assert.equal(withoutGoogleActions(`Voir [le suivi](${SHEET}) pour le détail.`), `Voir [le suivi](${SHEET}) pour le détail.`);
});

test("a shortcut in the drive points to its document", () => {
  assert.equal(shortcutKind("Suivi des candidatures.gsheet"), "sheets");
  assert.equal(shortcutKind("rapport.pdf"), null);
  assert.equal(shortcutTitle("Fiche de poste BDM.gdoc"), "Fiche de poste BDM");
  assert.deepEqual(parseShortcut("Suivi.gsheet", JSON.stringify({ url: SHEET })), { id: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd", kind: "sheets", url: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/edit", title: "Suivi" });
  assert.equal(parseShortcut("Plan.gslides", JSON.stringify({ doc_id: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd", title: "Plan Q4" }))?.url, "https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/edit");
  assert.equal(parseShortcut("Suivi.gsheet", "pas du json"), null);
  assert.equal(parseShortcut("Suivi.gsheet", JSON.stringify({ url: "https://evil.example/x" })), null);
});

test("the document named in a later reply, without its link, is the one in use", () => {
  const used = usedGoogleDocs([
    { text: `🔗 [Ouvrir le suivi des candidatures](${SHEET})`, at: 1 },
    { text: `🔗 [Ouvrir la fiche de poste BDM](${DOC})`, at: 2 },
    { text: "✅ Les statuts sont à jour dans le Suivi des candidatures.", at: 3 },
  ]);
  assert.deepEqual(used.map((d) => [d.title, d.usedAt]), [["Suivi des candidatures", 3], ["Fiche de poste BDM", 2]]);
  assert.deepEqual(usedGoogleDocs([{ text: `Le tableau : ${SHEET}`, at: 1 }, { text: "Google Sheets est ouvert.", at: 2 }]).map((d) => d.usedAt), [1]);
});

test("a bare link takes its title from the sentence before it", () => {
  const url = "https://docs.google.com/presentation/d/1P2wblICUsczE5qoSsDbYjaWAlxHJppINmZkXaQmWI/edit";
  const [d] = googleDocs(`Ces trois points sont dans la présentation WhatsApp, pages 13 à 17 :\n${url}`);
  assert.equal(d.title, "Présentation WhatsApp");
  const [h] = googleDocs(`Il est dans la présentation WhatsApp.\n\n${url}`);
  assert.equal(h.title, "Google Slides");
  const [e] = googleDocs(`Ces trois points sont dans la présentation WhatsApp, pages 13 à 17 : ${url}`);
  assert.equal(e.title, "Présentation WhatsApp");
  const [f] = googleDocs(`Le kit de test WhatsApp v3 est à jour : ${url}`);
  assert.equal(f.title, "Kit de test WhatsApp v3");
  const [g] = googleDocs(`Voici le document : ${url}`);
  assert.equal(g.title, "Google Slides");
});

test("a page count names nothing; an unnamed document says so, a member's name wins", () => {
  const url = "https://docs.google.com/presentation/d/1P2wblICUsczE5qoSsDbYjaWAlxHJppINmZkXaQmWI/edit";
  const [d] = googleDocs(`Voici la présentation de 3 pages : ${url}`);
  assert.equal(d.title, "Google Slides");
  assert.ok(isUnnamed(d));
  assert.equal(docName(d, {}), "Présentation sans nom");
  assert.equal(docName(d, { [d.id]: "Books des artistes" }), "Books des artistes");
  assert.equal(docName({ ...d, title: "Deck démo" }, { [d.id]: "  " }), "Deck démo");
  assert.equal(cleanName("  Deck   démo \n v2 "), "Deck démo v2");
});

test("documents are grouped by the day they were last used, with the time", () => {
  const now = new Date(2026, 10, 18, 9, 0);
  assert.equal(dayHeading(new Date(2026, 10, 18, 8, 5).getTime(), now), "Aujourd’hui");
  assert.match(dayHeading(new Date(2026, 10, 17, 18, 20).getTime(), now), /^Hier, 17 nov/);
  assert.match(dayHeading(new Date(2026, 10, 14, 10, 0).getTime(), now), /^Samedi 14 nov/);
  assert.equal(dayHeading(null, now), "Plus ancien");
  assert.equal(usedTime(new Date(2026, 10, 18, 9, 5).getTime()), "09 h 05");
});
