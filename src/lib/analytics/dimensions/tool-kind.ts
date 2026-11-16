// Classe un nom d'outil appelé : outil intégré de Hermes, ouverture de compétence, outil d'un serveur
// MCP, ou outil de Composio.

import { COMPOSIO_TOOL_PREFIX, MCP_TOOL_PATTERN, SKILL_VIEW_TOOL } from "../../yele-mcp/hermes-layout.ts";

export type ToolKind =
  | { kind: "builtin" }
  | { kind: "skill" }
  | { kind: "mcp"; server: string; tool: string }
  | { kind: "composio"; tool: string };

export function toolKind(name: string): ToolKind {
  const mcp = MCP_TOOL_PATTERN.exec(name);
  if (mcp) return mcp[2].startsWith(COMPOSIO_TOOL_PREFIX) ? { kind: "composio", tool: mcp[2] } : { kind: "mcp", server: mcp[1], tool: mcp[2] };
  return name === SKILL_VIEW_TOOL ? { kind: "skill" } : { kind: "builtin" };
}
