import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answerCheckRefusal, parseCheckChoice, readAnswerCheck } from "./answer-check.ts";

describe("answer check", () => {
  it("reads the back office's view; anything missing falls back to the Expert's own model", () => {
    const v = readAnswerCheck({ source: "instance", effective: { provider: "anthropic", providerLabel: "Anthropic", model: "claude-sonnet-5-5", mode: "relance" }, own: { provider: "anthropic", model: "claude-sonnet-5-5" }, providers: [{ value: "anthropic", label: "Anthropic" }, { value: 3 }], lost: false });
    assert.equal(v.source, "instance");
    assert.equal(v.effective.mode, "relance");
    assert.deepEqual(v.providers, [{ value: "anthropic", label: "Anthropic" }]);
    const empty = readAnswerCheck(null);
    assert.deepEqual(empty, { source: "global", effective: { provider: null, providerLabel: null, model: null, mode: "observation" }, own: { provider: null, providerLabel: null, model: null }, providers: [], lost: false, others: [], canAdd: false });
  });

  it("reads the providers to add, with their catalogue entries; one without entries is dropped", () => {
    const v = readAnswerCheck({ others: [{ value: "openrouter", label: "OpenRouter", keys: ["openrouter"] }, { value: "x", label: "X", keys: [] }, { value: "y", label: "Y", keys: ["a b"] }], canAdd: true });
    assert.deepEqual(v.others, [{ value: "openrouter", label: "OpenRouter", keys: ["openrouter"] }]);
    assert.equal(v.canAdd, true);
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
