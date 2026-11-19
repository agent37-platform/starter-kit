import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answerCheckRefusal, checkDefault, parseCheckChoice, readAnswerCheck } from "./answer-check.ts";

describe("answer check", () => {
  it("reads the back office's view; anything missing falls back to the Expert's own model", () => {
    const v = readAnswerCheck({ source: "instance", effective: { provider: "anthropic", providerLabel: "Anthropic", model: "claude-sonnet-5-5", mode: "relance" }, own: { provider: "anthropic", model: "claude-sonnet-5-5" }, providers: [{ value: "anthropic", label: "Anthropic" }, { value: 3 }], lost: false });
    assert.equal(v.source, "instance");
    assert.equal(v.effective.mode, "relance");
    assert.deepEqual(v.providers, [{ value: "anthropic", label: "Anthropic" }]);
    const empty = readAnswerCheck(null);
    assert.deepEqual(empty, { source: "global", default: { provider: null, providerLabel: null, model: null, reason: "meme_fournisseur" }, effective: { provider: null, providerLabel: null, model: null, mode: "observation" }, own: { provider: null, providerLabel: null, model: null }, providers: [], lost: false, others: [], canAdd: false });
  });

  it("reads the providers to add, with their catalogue entries; one without entries is dropped", () => {
    const v = readAnswerCheck({ others: [{ value: "openrouter", label: "OpenRouter", keys: ["openrouter"] }, { value: "x", label: "X", keys: [] }, { value: "y", label: "Y", keys: ["a b"] }], canAdd: true });
    assert.deepEqual(v.others, [{ value: "openrouter", label: "OpenRouter", keys: ["openrouter"] }]);
    assert.equal(v.canAdd, true);
  });

  it("default: another provider of the space re-reads, else the Expert's own model; Yelema's setting shown as such", () => {
    const other = readAnswerCheck({ source: "global", default: { provider: "openrouter", providerLabel: "OpenRouter", model: "x/y", reason: "autre_fournisseur" }, effective: { provider: "openrouter", providerLabel: "OpenRouter", model: "x/y" } });
    assert.deepEqual(checkDefault(other), { label: "Par défaut : OpenRouter · x/y", line: "Un autre fournisseur relit les réponses de l’Expert." });
    const same = readAnswerCheck({ source: "global", default: { provider: "anthropic", providerLabel: "Anthropic", reason: "meme_fournisseur" }, effective: {} });
    assert.equal(checkDefault(same).label, "Par défaut : même modèle que l’Expert");
    assert.match(checkDefault(same).line, /relit ses propres réponses/);
    assert.equal(readAnswerCheck({ default: { provider: "openrouter", reason: "autre_fournisseur" } }).default.reason, "meme_fournisseur", "an incomplete default is not trusted");
    const sensitive = readAnswerCheck({ source: "global", default: { provider: "anthropic", providerLabel: "Anthropic", reason: "client_sensible" }, effective: {} });
    assert.equal(sensitive.default.reason, "client_sensible");
    assert.deepEqual(checkDefault(sensitive), { label: "Par défaut : même modèle que l’Expert", line: "Même modèle que l’Expert (client à données sensibles)." });
    const yelema = readAnswerCheck({ default: { reason: "meme_fournisseur" }, effective: { provider: "gemini", providerLabel: "Gemini", model: "g" } });
    assert.equal(checkDefault(yelema).line, "Réglé par Yelema : Gemini · g.");
  });

  it("sends provider and model only, never a mode, and refuses odd values", () => {
    assert.deepEqual(parseCheckChoice({ provider: "custom:Yelema", model: "deepseek/deepseek-v3", mode: "relance" }), { provider: "custom:Yelema", model: "deepseek/deepseek-v3" });
    assert.deepEqual(parseCheckChoice({ provider: "", model: "" }), { provider: "", model: "" });
    assert.equal(parseCheckChoice({ provider: "anthropic; rm", model: "x" }), null);
    assert.equal(parseCheckChoice({ provider: "anthropic" }), null);
    assert.equal(parseCheckChoice("x"), null);
  });

  it("a provider without an account gets its own sentence", () => {
    assert.match(answerCheckRefusal("bad_judge") ?? "", /ajoutez d’abord sa clé/);
    assert.equal(answerCheckRefusal("internal_error"), null);
  });
});
