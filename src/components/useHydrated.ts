"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => undefined;

/**
 * False on the server and during hydration, true after (and at once on a client navigation): data read
 * by the page on the server shows without the browser's dates and memory differing from the HTML.
 */
export const useHydrated = (): boolean => useSyncExternalStore(noop, () => true, () => false);
