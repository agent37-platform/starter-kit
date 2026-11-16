import type { CallCountRow } from "../../yele-mcp/types.ts";
import { mcpServerLabel } from "../names.ts";
import type { Dimension } from "../types.ts";
import { callsDimension, whoLabel } from "./calls.ts";
import { toolKind } from "./tool-kind.ts";

/** Serveur MCP d'un outil hors Composio, sinon null. */
function mcpServerOf(name: string): string | null {
  const k = toolKind(name);
  return k.kind === "mcp" ? k.server : null;
}

export function mcpTab(tools: CallCountRow[], nameOf: (profile: string) => string): Dimension {
  return callsDimension(
    tools,
    (r) => mcpServerOf(r.name),
    (server, g, share) => ({
      id: `mcp_${server}`,
      name: mcpServerLabel(server),
      subtitle: whoLabel(g.profiles, nameOf),
      iconKind: "mcp",
      share,
      volume: null,
      count: g.calls,
    })
  );
}
