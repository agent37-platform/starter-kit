import assert from "node:assert/strict";
import { test } from "node:test";
import { callDuration, callShareText, callHeaders, chosenVoice, expertDefaultVoice, countryFlag, countryName, filterVoices, sortVoices, isCallTranscript, parseVoicePrefs, signalingStep, transcriptOf, findInText, summarySections, frenchSpacing, voiceFacets, type VoiceOption } from "./voice.ts";

test("a relayed step is only one the SDK sends, with its own method", () => {
  assert.equal(signalingStep("conv_abc-1", "offer", "POST"), "offer");
  assert.equal(signalingStep("conv_abc-1", "ice", "PATCH"), "ice");
  assert.equal(signalingStep("conv_abc-1", "status", "GET"), "status");
  for (const [id, action, method] of [
    ["conv", "ice", "POST"],
    ["conv", "status", "POST"],
    ["conv", "delete", "POST"],
    ["conv", "toString", "POST"],
    ["../x", "end", "POST"],
    ["a/b", "end", "POST"],
    ["", "end", "POST"],
  ]) {
    assert.equal(signalingStep(id, action, method), null, `${id} ${action} ${method}`);
  }
});

test("call headers: expert and language required, voice optional, all normalised", () => {
  assert.deepEqual(callHeaders(new Headers({ "x-yelema-expert": " Koffi ", "x-yelema-language": "FR", "x-yelema-voice": "Moussa" })), {
    "X-Yelema-Expert": "koffi",
    "X-Yelema-Language": "fr",
    "X-Yelema-Voice": "moussa",
  });
  assert.deepEqual(callHeaders(new Headers({ "x-yelema-expert": "koffi", "x-yelema-language": "en" })), { "X-Yelema-Expert": "koffi", "X-Yelema-Language": "en" });
  assert.equal(callHeaders(new Headers({ "x-yelema-language": "fr" })), null);
  assert.equal(callHeaders(new Headers({ "x-yelema-expert": "koffi", "x-yelema-language": "de" })), null);
  assert.equal(callHeaders(new Headers({ "x-yelema-expert": "koffi", "x-yelema-language": "fr", "x-yelema-voice": "a/b" })), null);
});

test("call headers: the member's time zone passes when it is an IANA name, else it is dropped", () => {
  const base = { "x-yelema-expert": "koffi", "x-yelema-language": "fr" };
  assert.equal(callHeaders(new Headers({ ...base, "x-yelema-timezone": "Africa/Abidjan" }))?.["X-Yelema-Timezone"], "Africa/Abidjan");
  assert.equal(callHeaders(new Headers({ ...base, "x-yelema-timezone": "America/Argentina/Buenos_Aires" }))?.["X-Yelema-Timezone"], "America/Argentina/Buenos_Aires");
  assert.equal(callHeaders(new Headers({ ...base, "x-yelema-timezone": "UTC" }))?.["X-Yelema-Timezone"], "UTC");
  for (const bad of ["../etc", "Africa/Abidjan; drop", "a".repeat(80)]) assert.equal(callHeaders(new Headers({ ...base, "x-yelema-timezone": bad }))?.["X-Yelema-Timezone"], undefined, bad);
});

test("the voice of a call: the one chosen for the language, else its default, else its first", () => {
  const v = (key: string, language: "fr" | "en", isDefault = false) => ({ key, label: key, language, gender: "female" as const, country: "CI", previewUrl: "", default: isDefault });
  const voices = [v("adjoua", "fr"), v("akissi", "fr", true), v("amelia", "en")];
  assert.equal(chosenVoice(voices, { language: "fr", voices: { fr: "adjoua" } })?.key, "adjoua");
  assert.equal(chosenVoice(voices, { language: "fr", voices: {} })?.key, "akissi");
  assert.equal(chosenVoice(voices, { language: "fr", voices: { fr: "retiree" } })?.key, "akissi");
  assert.equal(chosenVoice(voices, { language: "en", voices: { fr: "adjoua" } })?.key, "amelia");
  assert.equal(chosenVoice([], { language: "fr", voices: {} }), null);
});

test("an Expert's own default voice: one of the new French voices of its gender, always the same", () => {
  const v = (key: string, label: string, isDefault = false) => ({ key, label, language: "fr" as const, gender: "female" as const, country: "FR", previewUrl: "", default: isDefault });
  const voices = [v("aicha", "Aïcha", true), v("v1", "Adele"), v("v2", "Emma"), v("v3", "Céline"), v("v4", "Léo"), v("v5", "Raphaël"), v("v6", "Clément"), v("v7", "Louise")];
  const her = expertDefaultVoice(voices, "fr", { key: "fatima", pronoun: "elle" });
  assert.ok(her && ["v1", "v2", "v3"].includes(her.key));
  assert.equal(expertDefaultVoice(voices, "fr", { key: "fatima", pronoun: "elle" })?.key, her?.key);
  assert.ok(["v4", "v5", "v6"].includes(expertDefaultVoice(voices, "fr", { key: "kouassi", pronoun: "il" })?.key ?? ""));
  assert.equal(expertDefaultVoice(voices, "fr", { key: "kouassi", pronoun: null }), null);
  // By rank, the voices in turn.
  assert.deepEqual([0, 1, 2, 3].map((rank) => expertDefaultVoice(voices, "fr", { key: "x", pronoun: "il", rank })?.key), ["v4", "v5", "v6", "v4"]);
  assert.equal(expertDefaultVoice(voices, "en", { key: "kouassi", pronoun: "il" }), null);
  // A voice chosen wins; without a gender, the language's default.
  assert.equal(chosenVoice(voices, { language: "fr", voices: { fr: "v7" } }, { key: "fatima", pronoun: "elle" })?.key, "v7");
  assert.equal(chosenVoice(voices, { language: "fr", voices: {} }, { key: "fatima", pronoun: "elle" })?.key, her?.key);
  assert.equal(chosenVoice(voices, { language: "fr", voices: {} }, { key: "x", pronoun: null })?.key, "aicha");
});

test("stored voice settings: read leniently, anything unreadable is no setting", () => {
  assert.deepEqual(parseVoicePrefs('{"language":"en","voices":{"en":"nana"}}'), { language: "en", voices: { en: "nana" } });
  assert.deepEqual(parseVoicePrefs('{"language":"de"}'), { language: "fr", voices: {} });
  assert.equal(parseVoicePrefs(null), null);
  assert.equal(parseVoicePrefs("{oops"), null);
});

test("call duration reads as spoken", () => {
  assert.equal(callDuration(196), "3 min 16 s");
  assert.equal(callDuration(120), "2 min");
  assert.equal(callDuration(45), "45 s");
  assert.equal(callDuration(null), "");
});

test("gender × country: each row narrows the other; neutral voices only under all genders", () => {
  const v = (key: string, gender: VoiceOption["gender"], country: string): VoiceOption => ({ key, label: key, language: "fr", gender, country, previewUrl: "", default: false });
  const voices = [v("claire", "female", "FR"), v("nicolas", "male", "FR"), v("adjoua", "female", "CI"), v("kouame", "neutral", "CI"), v("mamadou", "male", "SN")];
  const keys = (f: Parameters<typeof filterVoices>[1]) => filterVoices(voices, f).map((x) => x.key);
  assert.deepEqual(keys({ gender: null, country: null }), ["claire", "nicolas", "adjoua", "kouame", "mamadou"]);
  assert.deepEqual(keys({ gender: "female", country: "FR" }), ["claire"]);
  assert.deepEqual(keys({ gender: "male", country: null }), ["nicolas", "mamadou"]);
  assert.deepEqual(voiceFacets(voices, { gender: null, country: null }), { genders: ["female", "male"], countries: ["FR", "CI", "SN"] });
  assert.deepEqual(voiceFacets(voices, { gender: "female", country: null }).countries, ["FR", "CI"]);
  assert.deepEqual(voiceFacets(voices, { gender: null, country: "SN" }).genders, ["male"]);
  assert.equal(countryName("CI"), "Côte d’Ivoire");
  assert.equal(countryFlag("fr"), "🇫🇷");
});

test("a call transcript handed to the expert is recognised by its prefix, in both languages", () => {
  assert.equal(isCallTranscript("Transcription exacte de l'appel vocal du 17/10/2026 à 14:05 UTC (pour mémoire…)"), true);
  assert.equal(isCallTranscript("Exact transcript of the voice call of 17/10/2026 at 14:05 UTC — part 1/2 (for the record…)"), true);
  assert.equal(isCallTranscript("Peux-tu me donner la transcription exacte de l'appel vocal ?"), false);
  assert.equal(isCallTranscript("Demande faite pendant un appel vocal : …"), false);
});

test("transcriptOf keeps well-formed lines only", () => {
  assert.deepEqual(transcriptOf({}), []);
  assert.deepEqual(transcriptOf({ transcript: null }), []);
  const lines = [
    { who: "user", text: "Bonjour" },
    { who: "expert", text: " " },
    { who: "robot", text: "x" },
    null,
    { who: "expert", text: "Bonjour Aïcha" },
  ] as unknown as Parameters<typeof transcriptOf>[0]["transcript"];
  assert.deepEqual(transcriptOf({ transcript: lines }), [
    { who: "user", text: "Bonjour" },
    { who: "expert", text: "Bonjour Aïcha" },
  ]);
});

test("findInText ignores case and accents and gives ranges of the original text", () => {
  const t = "Réunion jeudi : la réunion de Bouaké.";
  assert.deepEqual(findInText(t, "reunion"), [
    [0, 7],
    [19, 26],
  ]);
  assert.equal(t.slice(...findInText(t, "BOUAKE")[0]), "Bouaké");
  assert.deepEqual(findInText(t, "  "), []);
  assert.deepEqual(findInText(t, "Abidjan"), []);
});

test("summarySections: the three sections when served, else null", () => {
  assert.equal(summarySections({}), null);
  assert.equal(summarySections({ keyPoints: [" "], decisions: null }), null);
  assert.deepEqual(summarySections({ keyPoints: ["A"], nextSteps: ["B", 3 as unknown as string] }), [
    { title: "Points clés", items: ["A"] },
    { title: "Prochaines étapes", items: ["B"] },
  ]);
});

test("transcriptOf keeps a valid timestamp only", () => {
  const t = [
    { who: "user", text: "a", at: 12 },
    { who: "expert", text: "b", at: -1 },
  ] as unknown as Parameters<typeof transcriptOf>[0]["transcript"];
  assert.deepEqual(transcriptOf({ transcript: t }), [
    { who: "user", text: "a", at: 12 },
    { who: "expert", text: "b" },
  ]);
});

test("frenchSpacing keeps « 5 % » and « : » with the word before", () => {
  assert.equal(frenchSpacing("une remise de 5 % ? Oui : « jeudi »"), "une remise de 5\u00a0%\u00a0? Oui\u00a0: «\u00a0jeudi\u00a0»");
  assert.equal(frenchSpacing("https://x.y"), "https://x.y");
  const t = frenchSpacing("remise de 5 % s’ils hésitent");
  assert.equal(t.slice(...findInText(t, "5 %")[0]), "5\u00a0%");
});

test("the voices kept by the back office: the expert's own over those for all; a patch clears what is unset", async () => {
  const { voicesFor, voicePatch } = await import("./voice.ts");
  assert.deepEqual(voicesFor({ "*": { fr: "akissi", en: "amelia" }, koffi: { fr: "moussa" } }, "koffi"), { fr: "moussa", en: "amelia" });
  assert.deepEqual(voicesFor({ "*": { fr: "akissi" } }, "awa"), { fr: "akissi" });
  assert.deepEqual(voicesFor({}, "awa"), {});
  assert.deepEqual(voicePatch("koffi", { fr: "moussa" }), { koffi: { fr: "moussa", en: null } });
});

test("a shared call reads as a short account, transcript last", () => {
  const text = callShareText(
    { summary: ["Point des commandes"], keyPoints: ["3 commandes en retard"], decisions: [], nextSteps: ["Relancer Prosuma"], transcript: [{ who: "user", text: "Le point." }, { who: "expert", text: "Voici." }] },
    { title: "Commandes Prosuma", meta: "27 oct. · 3 min", expertName: "Salif", memberName: "Leslie" }
  );
  assert.equal(text, "Appel avec Salif : Commandes Prosuma\n27 oct. · 3 min\n\nPoints clés\n- 3 commandes en retard\n\nProchaines étapes\n- Relancer Prosuma\n\nTranscription\nLeslie : Le point.\nSalif : Voici.\n");
  assert.ok(!callShareText({ summary: ["Vu"] }, { title: "T", meta: "", expertName: "S", memberName: "L" }).includes("Transcription"));
});

test("voices: France first, then countries and first names in French order", () => {
  const v = (label: string, country: string) => ({ key: label, label, language: "fr" as const, gender: "female" as const, country, previewUrl: "", default: false });
  assert.deepEqual(sortVoices([v("Aïcha", "CM"), v("Léa", "FR"), v("Akissi", "CI"), v("Adèle", "FR")]).map((x) => x.label), ["Adèle", "Léa", "Aïcha", "Akissi"]);
  assert.deepEqual(voiceFacets([v("A", "CM"), v("B", "FR"), v("C", "CI")], { gender: null, country: null }).countries, ["FR", "CM", "CI"]);
});
