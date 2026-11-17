// Lecteur de recherche dans la mémoire des experts (memories/MEMORY.md), sans tenir compte des accents
// ni de la casse.

import { hermesReader, type InstanceReader } from "./hermes-layout.ts";
import { masquerSecrets } from "./secrets.ts";
import type { MemorySearchResult } from "./types.ts";

/** Nombre maximal de paragraphes par expert. */
export const MATCHES_PER_EXPERT = 3;

const SCRIPT = String.raw`
import re, unicodedata
fold = lambda s: "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")
query = fold(P["query"].strip())
target = (P.get("expert") or "").strip().lower()
results = []
for expert, home in (expert_homes() if query else []):
    if target and expert.lower() != target:
        continue
    path = _os.path.join(home, L["hermes"]["memory"])
    if not _os.path.exists(path):
        continue
    with open(path, encoding="utf-8", errors="replace") as f:
        paragraphs = re.split(r"\n\s*\n", f.read())
    matches = [p.strip() for p in paragraphs if query in fold(p)][: P["perExpert"]]
    if matches:
        results.append({"expId": expert, "matches": matches})
emit(results)
`;

export const memorySearchReader = (query: string, expert?: string): InstanceReader =>
  hermesReader(SCRIPT, { query, expert: expert ?? null, perExpert: MATCHES_PER_EXPERT });

/** Valide le résultat du lecteur et masque les secrets des paragraphes. */
export function parseMemorySearch(json: string): MemorySearchResult[] {
  const raw = JSON.parse(json) as unknown;
  if (!Array.isArray(raw)) throw new Error("sortie inattendue");
  return raw
    .filter((r): r is { expId: string; matches: unknown } => typeof r === "object" && r !== null && typeof (r as { expId?: unknown }).expId === "string")
    .map((r) => ({
      expId: r.expId,
      matches: (Array.isArray(r.matches) ? r.matches : []).filter((m): m is string => typeof m === "string").map(masquerSecrets),
    }));
}
