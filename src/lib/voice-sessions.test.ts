import assert from "node:assert/strict";
import { test } from "node:test";
import { isVoiceSession } from "./voice-sessions.ts";

test("les sessions ouvertes par un appel sont reconnues, une conversation écrite non", () => {
  for (const p of [
    "Demande faite pendant un appel vocal : ta réponse sera lue",
    "Un appel vocal commence maintenant avec toi",
    "Préparation de ton prochain appel vocal avec cette personne",
    "Transcription exacte de l'appel vocal du 25 octobre",
    "A request made during a voice call: your reply",
  ]) assert.ok(isVoiceSession(p), p);
  for (const p of ["Hello djeneba as tu accès a WhatsApp", "Prépare mon prochain appel vocal avec MTN", "", null]) assert.ok(!isVoiceSession(p), String(p));
});

test("la session d'un appel (sa transcription) est une conversation nommée par sa date", async () => {
  const { isCallSession, callStartOf, callTitle } = await import("./voice-sessions.ts");
  const p = "Transcription exacte de l'appel vocal du 20/11/2026 à 14:05 UTC (pour mémoire…)";
  assert.ok(isCallSession(p));
  assert.ok(isCallSession("Exact transcript of the voice call of 20/11/2026 at 14:05 UTC — part 1/2"));
  for (const q of ["Demande faite pendant un appel vocal : …", "Un appel vocal commence", "Peux-tu me donner la transcription exacte de l'appel vocal ?", null]) assert.ok(!isCallSession(q), String(q));
  assert.equal(callStartOf(p), Date.UTC(2026, 10, 20, 14, 5));
  assert.equal(callStartOf("Transcription exacte de l'appel vocal du 25 octobre"), null);
  assert.equal(callTitle(Date.UTC(2026, 10, 20, 14, 5)), "Appel du 20 nov. à 14:05");
  assert.equal(callTitle(null), "Appel");
});
