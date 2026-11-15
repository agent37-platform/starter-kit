// True at most once per `gapMs` for each key: a call made on many triggers goes out once. No imports: tested.
export function oncePer(gapMs: number): (key: string, now?: number) => boolean {
  const last = new Map<string, number>();
  return (key, now = Date.now()) => {
    const at = last.get(key);
    if (at != null && now - at < gapMs) return false;
    last.set(key, now);
    return true;
  };
}
