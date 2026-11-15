// The choices a finished reply ends on (« A) …, B) … » or « 1. …, 2. … »), answered in one click, read
// from the text itself so they also hold after a reload.
// Anything that does not clearly match stays plain text: a reply is never rewritten by a guess.

export interface ReplyChoice {
  /** « A »… or « 1 »…, as the expert wrote it. */
  letter: string;
  label: string;
  /** Marked « (par défaut) » by the expert. */
  isDefault: boolean;
}

export interface ReplyParts {
  /** The text to show when the choices are buttons: without them. */
  body: string;
  /** The text to show when they are not (an older question): the choices stay written. */
  text: string;
  choices: ReplyChoice[];
  /** The line under the choices (« Sans réponse, je pars sur A à 15 h »). */
  choicesNote: string | null;
}

const OPTION = /^\s*(?:[-*•]\s+)?(?:\*\*|__)?([A-F]|[1-9])(?:\*\*|__)?\s*(?:[).:–—-]|\s:)\s*(?:\*\*|__)?\s*(\S.*)$/;
const DEFAULT_MARK = /\s*[([]?\s*par défaut\s*[)\]]?\s*[.,]?\s*$/i;
const MAX_LABEL = 100;
const MAX_NOTE = 140;

const plain = (s: string) => s.replace(/\*\*|__/g, "").replace(/^_(.*)_$/, "$1").trim();
const unclosedFence = (lines: string[]) => lines.filter((l) => l.trimStart().startsWith("```")).length % 2 === 1;

function trimEnd(lines: string[]): string[] {
  const out = [...lines];
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

export function replyParts(text: string): ReplyParts {
  const lines = trimEnd(text.split("\n"));
  const written = lines.join("\n");
  const choices = readChoices(lines);
  if (!choices) return { body: written, text: written, choices: [], choicesNote: null };
  return { body: trimEnd(lines.slice(0, choices.start)).join("\n"), text: written, choices: choices.items, choicesNote: choices.note };
}

const CHOICE_WORDS = /\b(quel(le)?s?|lequel|laquelle|lesquel(le)?s|pr[ée]f[ée]r|choisi|choix|voulez|veux|souhait|option|on part sur|which|prefer|choose|want)/i;

function readChoices(lines: string[]): { items: ReplyChoice[]; note: string | null; start: number } | null {
  // One short line may follow the options.
  let end = lines.length;
  let note: string | null = null;
  const last = lines[end - 1];
  if (last !== undefined && !OPTION.test(last)) {
    if (last.length > MAX_NOTE) return null;
    note = plain(last);
    end = trimEnd(lines.slice(0, end - 1)).length;
  }

  // Up from the end, the options, in order and without a gap in the letters.
  const found: { letter: string; label: string; line: number }[] = [];
  let i = end - 1;
  for (; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    const m = lines[i].match(OPTION);
    if (!m) break;
    found.unshift({ letter: m[1], label: plain(m[2]), line: i });
  }
  if (found.length < 2) return null;
  // One series, in order from its start: A, B, C… or 1, 2, 3…
  const nth = (k: number) => (/\d/.test(found[0].letter) ? String(k + 1) : String.fromCharCode(65 + k));
  if (found.some((f, k) => f.letter !== nth(k) || f.label.length > MAX_LABEL || !f.label)) return null;

  // They answer something: the line above asks, or announces them. A plan written as « A) … » does not.
  if (i < 0) return null;
  const asking = plain(lines[i]);
  // « : » seul annonce aussi une liste d'étapes : il faut une tournure de choix, ou une question sous les options.
  const asks = /\?$/.test(asking) || (/:$/.test(asking) && (CHOICE_WORDS.test(asking) || /\?/.test(note ?? "")));
  if (!asks) return null;
  if (unclosedFence(lines.slice(0, found[0].line))) return null;

  return {
    items: found.map((f) => ({ letter: f.letter, label: f.label.replace(DEFAULT_MARK, "").trim(), isDefault: DEFAULT_MARK.test(f.label) })),
    note,
    start: found[0].line,
  };
}

/** What the member's click sends: the letter for the expert, the words for whoever reads the thread. */
export const choiceMessage = (c: ReplyChoice) => `${c.letter} : ${c.label}`;
