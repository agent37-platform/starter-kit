import assert from "node:assert/strict";
import { test } from "node:test";

import { jobOnly } from "./job-only.ts";

test("le métier seul, sans « Expert IA » devant", () => {
  assert.equal(jobOnly("Expert IA veille commerciale"), "Veille commerciale");
  assert.equal(jobOnly("Experte IA pilotage commercial"), "Pilotage commercial");
  assert.equal(jobOnly("Expert IA en recrutement"), "Recrutement");
  assert.equal(jobOnly("Design & Brand"), "Design & Brand");
  assert.equal(jobOnly("Expert IA"), "Expert IA");
  assert.equal(jobOnly(null), null);
});
