import assert from "node:assert/strict";
import { test } from "node:test";
import { connectorLabel, expertTitle, humanize, mcpServerLabel, modelLabel, skillLabel } from "./names.ts";
import { DEFAULT_QUERY, parseQuery, queryString } from "./query.ts";

test("parseQuery : valeurs connues gardées, inconnues remplacées par défaut, filtres bornés", () => {
  assert.deepEqual(parseQuery(new URLSearchParams("")), DEFAULT_QUERY);
  const q = parseQuery(new URLSearchParams("period=90_jours&granularity=semaine&experts=koffi,awa,koffi&routines=koffi%2Fbbb222&models=x%00y"));
  assert.equal(q.period, "90_jours");
  assert.equal(q.granularity, "semaine");
  assert.deepEqual(q.filters, { experts: ["koffi", "awa"], channels: [], models: [], routines: ["koffi/bbb222"] });
  assert.equal(parseQuery(new URLSearchParams("period=10_ans&granularity=heure")).period, "30_jours");
  const many = Array.from({ length: 80 }, (_, i) => `e${i}`).join(",");
  assert.equal(parseQuery(new URLSearchParams(`experts=${many}`)).filters.experts.length, 50);
  assert.deepEqual(parseQuery(new URLSearchParams(`experts=${"a".repeat(201)}`)).filters.experts, []);
});

test("queryString puis parseQuery redonnent la même requête", () => {
  const q = { period: "7_jours" as const, granularity: "mois" as const, filters: { experts: ["koffi"], channels: ["telegram"], models: [], routines: ["koffi/bbb222"] } };
  assert.deepEqual(parseQuery(new URLSearchParams(queryString(q))), q);
});

test("noms lisibles : modèles par id ou id sans fournisseur, compétences, serveurs MCP, connecteurs", () => {
  assert.equal(humanize("rendre_livrable-final"), "Rendre livrable final");
  assert.equal(modelLabel("openai/gpt-6-luna", { "gpt-6-luna": "GPT 6 Luna" }), "GPT 6 Luna");
  assert.equal(modelLabel("claude-opus-5-5", null), "claude-opus-5-5");
  assert.equal(modelLabel("default", null), "Modèle par défaut de l'instance");
  assert.equal(skillLabel("borne-09/2-mon-metier/data-room"), "Data room");
  assert.equal(mcpServerLabel("notion"), "Notion");
  assert.equal(mcpServerLabel("memoire"), "Memoire");
  assert.equal(connectorLabel("googlesheets", "Google Sheets").name, "Google Sheets");
  assert.equal(connectorLabel("outil_inconnu", null).name, "Outil inconnu");
});

test("expertTitle : le titre seul, sans la précision qui le suit", () => {
  assert.equal(expertTitle("Chief of Staff : agenda, notes de réunion, relances"), "Chief of Staff");
  assert.equal(expertTitle("Assistante de direction — agenda et notes"), "Assistante de direction");
  assert.equal(expertTitle("Juriste - contrats"), "Juriste");
  assert.equal(expertTitle("Analyste (finance)"), "Analyste");
  assert.equal(expertTitle("Comptable | clôtures\nmensuelles"), "Comptable");
  assert.equal(expertTitle("Co-pilote commercial."), "Co-pilote commercial");
  assert.equal(expertTitle("Design & DA"), "Design & DA");
  assert.equal(expertTitle(""), "");
});
