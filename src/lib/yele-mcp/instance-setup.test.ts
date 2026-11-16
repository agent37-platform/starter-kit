import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInstanceSetup } from "./instance-setup.ts";

test("parseInstanceSetup : routines et serveurs MCP de chaque profil, lignes malformées écartées, partie illisible à null", () => {
  const s = parseInstanceSetup(
    JSON.stringify({
      profiles: {
        koffi: { routines: [["bbb222", "Veille (Koffi)", true, "0 8 * * *"], ["", "sans id", true, ""], "x"], mcpServers: ["apps", 3] },
        // yaml absent sur l'instance : ses serveurs sont inconnus, ses routines lues.
        awa: { routines: [], mcpServers: null },
        default: { routines: null, mcpServers: [] },
      },
    })
  );
  assert.deepEqual(s.profiles.koffi, {
    routines: [{ id: "bbb222", name: "Veille (Koffi)", enabled: true, schedule: "0 8 * * *" }],
    mcpServers: ["apps"],
  });
  assert.deepEqual(s.profiles.awa, { routines: [], mcpServers: null });
  assert.deepEqual(s.profiles.default, { routines: null, mcpServers: [] });
  assert.throws(() => parseInstanceSetup(JSON.stringify({ profiles: [] })));
});
