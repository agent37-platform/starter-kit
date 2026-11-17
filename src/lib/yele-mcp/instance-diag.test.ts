import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDiscoveredExperts } from "./discover-experts.ts";
import { parseInstanceDiag } from "./instance-diag.ts";
import { parseMemorySearch } from "./memory-search.ts";

const TOKEN = "123456789:AAEhBOweik9ai3H9b7hK3kVcD1XbJmXiZq0";

test("parseInstanceDiag : champs vérifiés un à un, textes de l'instance masqués, rien d'inventé", () => {
  const d = parseInstanceDiag(
    JSON.stringify({
      telegram: { bot: "@yelema_bot", chatId: -100, phase: "ready", topics: { "12": "koffi", "13": 7 }, secret: "x" },
      mail: { addresses: { koffi: "koffi@client.fr" } },
      routineErrors: { koffi: 2, awa: "trois" },
      routineErrorsByDay: { "2026-11-14": { koffi: 1 } },
      connectors: { koffi: [{ nom: "Gmail", etat: "erreur", note: `jeton ${TOKEN}` }] },
      skills: [{ expId: "koffi", specific: ["a"], shared: ["b", 3] }],
      voiceBriefs: [{ expId: "koffi", at: "2026-11-14T08:00:00Z", text: "brief" }],
      alerts: {
        incidents: [{ type: "CRON_ERROR", expert: "koffi", ts: "2026-11-14T08:00:00Z", error: `Bot ${TOKEN} refusé` }],
        avertissements: [{ type: "CONNECTOR_WARNING", expert: "awa", outil: "Notion", etat: "a-refaire" }],
        totalCronsScanned: 40,
        telegramPhase: "ready",
      },
      unreadable: ["audit:nadia"],
    })
  );
  assert.deepEqual(d.telegram?.topics, { "12": "koffi" });
  assert.equal((d.telegram as Record<string, unknown>).secret, undefined);
  assert.deepEqual(d.routineErrors, { koffi: 2 });
  assert.deepEqual(d.routineErrorsByDay, { "2026-11-14": { koffi: 1 } });
  assert.doesNotMatch(d.alerts.incidents[0].error ?? "", /AAEh/);
  assert.doesNotMatch(d.connectors.koffi[0].note ?? "", /AAEh/);
  assert.deepEqual(d.skills[0].shared, ["b"]);
  assert.equal(d.alerts.telegramPhase, "ready");
  assert.deepEqual(d.unreadable, ["audit:nadia"]);
  // Pas de Telegram ni d'e-mail : null, pas une configuration vide.
  const bare = parseInstanceDiag(JSON.stringify({ alerts: {} }));
  assert.equal(bare.telegram, null);
  assert.equal(bare.mail, null);
  assert.equal(bare.alerts.telegramPhase, null);
  assert.throws(() => parseInstanceDiag(JSON.stringify([])));
});

test("parseDiscoveredExperts : le nom de SOUL.md, sinon l'identifiant du profil", () => {
  assert.deepEqual(
    parseDiscoveredExperts(
      JSON.stringify([
        { id: "koffi", name: "Koffi", description: "Créatif" },
        { id: "awa", name: "", description: "" },
        { name: "sans id" },
      ])
    ),
    [
      { id: "koffi", name: "Koffi", description: "Créatif" },
      { id: "awa", name: "awa", description: "" },
    ]
  );
  assert.throws(() => parseDiscoveredExperts("{}"));
});

test("parseMemorySearch : paragraphes rendus masqués de leurs secrets", () => {
  const [r] = parseMemorySearch(JSON.stringify([{ expId: "koffi", matches: [`Le bot ${TOKEN}`, 4] }]));
  assert.equal(r.expId, "koffi");
  assert.equal(r.matches.length, 1);
  assert.doesNotMatch(r.matches[0], /AAEh/);
});
