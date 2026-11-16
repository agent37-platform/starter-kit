// Every outbound call that is not a stream gets a deadline, so a hung peer frees the function
// instead of holding it until the host's own limit. The caller's own signal still applies.
export function withTimeout(init: RequestInit | undefined, ms: number): RequestInit {
  const deadline = AbortSignal.timeout(ms);
  return { ...init, signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline };
}

/** For reads and writes of JSON; streams (SSE, file bodies) get none. */
export const JSON_TIMEOUT_MS = 30_000;
/** A command inside an instance may run longer than a read. */
export const EXEC_TIMEOUT_MS = 120_000;

/** Résout comme `promise`, ou rejette après `ms` millisecondes. */
export function beforeDeadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} : pas de réponse en ${ms} ms`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** A deadline on the answer's headers only: the body may then stream as long as it needs. */
export async function fetchUntilHeaders(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error("headers timeout")), ms);
  try {
    return await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, ctl.signal]) : ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}
