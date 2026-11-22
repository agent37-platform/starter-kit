// Orders the platform writes to an expert on the member's behalf (a meeting's minutes after the call, their
// publication as a web page): saved as user messages, they showed as long technical bubbles under the
// member's name, file paths and JSON included (Leslie, 20/11). Shown as one status line instead. No imports,
// for `node --test`.

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

const MINUTES = /^Compte rendu de réunion à rédiger\b/;
const STARTED = /commencé le (\d{4})-(\d{2})-(\d{2})T/;
const PUBLISH = /^Publie le compte rendu\b/;
// Any other order of the platform: it asks for a file under ~/Livrables written as JSON, which a member never types.
const MACHINE = /~\/Livrables\/[^\n]*\.json\b[\s\S]*\bJSON valide\b|\bJSON valide\b[\s\S]*~\/Livrables\/[^\n]*\.json\b/;

// Two file paths of the expert's drive in one message: written by the platform, a member never types them.
const PATHS = /(~|\/home\/node)\/Livrables\//g;

export type AutoRequestKind = "minutes" | "publish" | "other";

export interface AutoRequest {
  kind: AutoRequestKind;
  /** The line shown in place of the bubble. */
  label: string;
}

export function autoRequest(content: string): AutoRequest | null {
  const text = content.trim();
  if (MINUTES.test(text)) {
    const m = STARTED.exec(text.split("\n")[0]) ?? [];
    const day = m[3] ? ` du ${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""}`.trimEnd() : "";
    return { kind: "minutes", label: `Compte rendu de la réunion${day} demandé automatiquement` };
  }
  if (PUBLISH.test(text)) return { kind: "publish", label: "Mise en ligne du compte rendu demandée automatiquement" };
  if (MACHINE.test(text) || (text.match(PATHS) ?? []).length >= 2) return { kind: "other", label: "Consigne automatique transmise à l’Expert" };
  return null;
}
