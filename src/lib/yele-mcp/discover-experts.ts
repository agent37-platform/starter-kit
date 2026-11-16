// Lecteur des experts installés, avec le nom et la description de leur SOUL.md.

import { hermesReader, type InstanceReader } from "./hermes-layout.ts";
import type { DiscoveredExpert } from "./types.ts";

const SCRIPT = String.raw`
import re
FIELD = lambda key: re.compile(r'^' + key + r':\s*["\']?(.*?)["\']?\s*$', re.M)
NAME, DESCRIPTION = FIELD("name"), FIELD("description")
experts = []
for expert, home in expert_homes():
    name, description = "", ""
    soul = _os.path.join(home, L["hermes"]["soul"])
    if _os.path.exists(soul):
        with open(soul, encoding="utf-8", errors="replace") as f:
            text = f.read()
        m = NAME.search(text)
        name = m.group(1).strip() if m else ""
        m = DESCRIPTION.search(text)
        description = m.group(1).strip() if m else ""
    experts.append({"id": expert, "name": name, "description": description})
emit(experts)
`;

export const discoverExpertsReader = (): InstanceReader => hermesReader(SCRIPT);

/** Valide le résultat du lecteur ; sans nom, l'expert prend son id de profil. */
export function parseDiscoveredExperts(json: string): DiscoveredExpert[] {
  const raw = JSON.parse(json) as unknown;
  if (!Array.isArray(raw)) throw new Error("sortie inattendue");
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null && typeof (e as { id?: unknown }).id === "string")
    .map((e) => {
      const id = e.id as string;
      return { id, name: typeof e.name === "string" && e.name ? e.name : id, description: typeof e.description === "string" ? e.description : "" };
    });
}
