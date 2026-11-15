// Values pushed many times per frame (a chat's stream deltas), applied once per frame, the latest per
// key. `flush` applies at once (stream end, abort); `cancel` drops what is pending. No imports: tested.
export interface FrameBatch<K, V> {
  push(key: K, value: V): void;
  flush(): void;
  cancel(): void;
}

export function frameBatch<K, V>(
  apply: (pending: Map<K, V>) => void,
  schedule: (run: () => void) => unknown = (run) => requestAnimationFrame(run),
  unschedule: (handle: unknown) => void = (h) => cancelAnimationFrame(h as number)
): FrameBatch<K, V> {
  let pending = new Map<K, V>();
  let handle: unknown = null;
  const flush = () => {
    if (handle !== null) unschedule(handle);
    handle = null;
    if (!pending.size) return;
    const batch = pending;
    pending = new Map();
    apply(batch);
  };
  return {
    push(key, value) {
      pending.set(key, value);
      handle ??= schedule(flush);
    },
    flush,
    cancel() {
      if (handle !== null) unschedule(handle);
      handle = null;
      pending = new Map();
    },
  };
}
