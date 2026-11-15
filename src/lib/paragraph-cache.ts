// A rewrite run again on every delta of a growing text (a live answer): the paragraphs up to the last
// blank line are rewritten once, only the tail each time. Only for a rewrite that never reaches across
// a blank line, so that rewriting the parts and joining them equals rewriting the whole. No imports: tested.
export function paragraphCache<T>(rewrite: (text: string) => T, join: (head: T, tail: T) => T): (text: string) => T {
  let head = "";
  let done: T | null = null;
  return (text) => {
    const cut = text.lastIndexOf("\n\n") + 2;
    if (cut < 2) return rewrite(text);
    const prefix = text.slice(0, cut);
    if (done === null || prefix !== head) {
      done = done !== null && head && prefix.startsWith(head) ? join(done, rewrite(prefix.slice(head.length))) : rewrite(prefix);
      head = prefix;
    }
    return join(done, rewrite(text.slice(cut)));
  };
}
