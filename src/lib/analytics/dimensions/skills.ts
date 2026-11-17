import type { CallCountRow } from "../../yele-mcp/types.ts";
import { skillLabel } from "../names.ts";
import type { Dimension } from "../types.ts";
import { callsDimension, whoLabel } from "./calls.ts";

export function skillsTab(rows: CallCountRow[], nameOf: (profile: string) => string): Dimension {
  return callsDimension(
    rows,
    (r) => skillLabel(r.name),
    (label, g, share) => ({
      id: `skill_${label}`,
      name: label,
      subtitle: whoLabel(g.profiles, nameOf),
      iconKind: "skill",
      share,
      volume: null,
      count: g.calls,
    })
  );
}
