// A long conversation is compacted by its runtime: the summary it writes for itself is never a message, and
// each compaction shows as one marker line. No imports, for `node --test`.

// The last alternative is the task list Hermes re-injects as a user row after compacting: for the expert only.
const NOTE = String.raw`(\[(CONTEXT COMPACTION|PRIOR CONTEXT|CONTEXT SUMMARY)\b|This session is being continued from a previous conversation|\[Your active task list was preserved across context compression\])`;
const SUMMARY = new RegExp(`^\\s*${NOTE}`, "i");
// The same note folded after a message's own text, on a line of its own: cut from there to the end.
const FOLDED = new RegExp(`\\n\\s*${NOTE}[\\s\\S]*$`, "i");

export const isCompactionSummary = (content: string): boolean => SUMMARY.test(content);

/** A message without the compaction note folded at its end. */
export const withoutCompactionNote = (content: string): string => content.replace(FOLDED, "").trimEnd();

// A reply the runtime replays after a compaction comes back word for word (Djénéba's audit, 29/10: the
// same answers two to four times further down the thread). Short ones (« C'est noté. ») may honestly recur.
const REPLAY_MIN = 40;

// One message of the member saved several times by the runtime, at the same instant (Maya's and Djénéba's
// audits, 03/11: the same line 2 to 11 times in a row). A message sent again later keeps its own bubble.
const sameUserMessage = (a: { role: string; content: string; created_at?: string | number | null } | undefined, b: { role: string; content: string; created_at?: string | number | null }): boolean =>
  a?.role === "user" &&
  b.role === "user" &&
  (a.content ?? "").trim() === (b.content ?? "").trim() &&
  (a.created_at ?? null) === (b.created_at ?? null);

/** The rows a thread shows: summaries out, back-to-back markers folded into one, a long reply never twice, a member's message saved twice at once shown once. */
export function visibleHistory<T extends { role: string; content: string; created_at?: string | number | null }>(rows: readonly T[]): T[] {
  const out: T[] = [];
  const said = new Set<string>();
  for (let row of rows) {
    if (isCompactionSummary(row.content ?? "")) continue;
    const content = withoutCompactionNote(row.content ?? "");
    if (content !== (row.content ?? "").trimEnd()) row = { ...row, content };
    if (row.role === "system" && out.at(-1)?.role === "system") continue;
    if (sameUserMessage(out.at(-1), row)) continue;
    if (row.role === "assistant") {
      const text = (row.content ?? "").trim();
      if (text.length >= REPLAY_MIN) {
        if (said.has(text)) continue;
        said.add(text);
      }
    }
    out.push(row);
  }
  return out;
}
