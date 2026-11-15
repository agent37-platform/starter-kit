// A first screen read with the page on the server, handed to its client view as `initial`. Shared by
// the server pages and the views' hooks; no imports: tested.

/** One space of the member: their own instance (`profileId` null) or an Expert's. */
export const spaceKey = (agentId: string, profileId: string | null): string => `${agentId}:${profileId ?? ""}`;

/** `promise`'s value, or null when it fails or takes longer than `ms` (the browser then reads it itself). */
export function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms)));
  return Promise.race([promise.catch(() => null), late]).finally(() => clearTimeout(timer));
}

/** Each key's answer; a key that failed is left out, so the view treats it as its own failed read. */
export async function settledByKey<T>(keys: string[], load: (key: string) => Promise<T>): Promise<Record<string, T>> {
  const all = await Promise.allSettled(keys.map(load));
  return Object.fromEntries(keys.flatMap((k, i) => (all[i].status === "fulfilled" ? [[k, (all[i] as PromiseFulfilledResult<T>).value]] : [])));
}
