import type { DriveFile } from "./drive-links.ts";
import type { CallRecord } from "./voice.ts";

// The conversation of a call (Leslie, 20/11, option A): its first message is the transcript handed to the
// expert; the chat shows instead the call, its summary and what was delivered. No `@/` imports: tested.

/** The call of this conversation: the one whose session it is, else the one that began within 10 min of the transcript's time. */
export function pickCall(calls: readonly CallRecord[], sessionId: string | null, start: number | null): CallRecord | null {
  const own = sessionId ? calls.find((c) => c.id === sessionId) : undefined;
  if (own) return own;
  if (start == null) return null;
  let best: CallRecord | null = null;
  let gap = 10 * 60_000;
  for (const c of calls) {
    const d = Math.abs(Date.parse(c.startedAt) - start);
    if (d <= gap) {
      best = c;
      gap = d;
    }
  }
  return best;
}

/** Live after the call, the expert keeps working on what was asked: its files of the call and the quarter of an hour after. */
const AFTER_MS = 15 * 60_000;

/** The files of the expert's folder written during the call (and just after), newest first: paths. */
export function callFiles(listing: readonly DriveFile[], start: number, end: number | null): string[] {
  const until = (end ?? start + 2 * 3_600_000) + AFTER_MS;
  return listing
    .filter((f) => f.type !== "directory" && !f.hidden && f.modified >= start - 60_000 && f.modified <= until)
    .sort((a, b) => b.modified - a.modified)
    .map((f) => f.path);
}
