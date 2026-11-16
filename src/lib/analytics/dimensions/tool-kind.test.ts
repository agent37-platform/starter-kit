import assert from "node:assert/strict";
import { test } from "node:test";
import { toolKind } from "./tool-kind.ts";

test("toolKind : outil intégré, compétence, outil MCP, outil Composio", () => {
  assert.deepEqual(toolKind("terminal"), { kind: "builtin" });
  assert.deepEqual(toolKind("skill_view"), { kind: "skill" });
  assert.deepEqual(toolKind("mcp__memoire__rechercher"), { kind: "mcp", server: "memoire", tool: "rechercher" });
  assert.deepEqual(toolKind("mcp__apps__YELEMA_PREPARER_FICHIER"), { kind: "mcp", server: "apps", tool: "YELEMA_PREPARER_FICHIER" });
  assert.deepEqual(toolKind("mcp__apps__COMPOSIO_SEARCH_TOOLS"), { kind: "composio", tool: "COMPOSIO_SEARCH_TOOLS" });
});
