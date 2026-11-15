"use client";

import { useEffect } from "react";
import { useOwnAgentId } from "@/components/conversations/useAllConversations";
import { wakeInstance } from "./wake";

// The instance sleeps after 30 idle minutes, and the member's next message waits for it to wake.
// While the app is on screen, one light read every 25 minutes keeps it up; a tab left in the
// background asks nothing, so a forgotten tab does not keep a machine running all night. Back on
// screen after a while, the read goes out at once: the instance wakes while the member reads. A
// screen left open with nobody at it stops asking after an hour without a click or a key.
const KEEP_AWAKE_MS = 25 * 60_000;
const AWAY_MS = 60 * 60_000;

export function ReadAhead() {
  const ownAgentId = useOwnAgentId();

  useEffect(() => {
    if (!ownAgentId) return;
    let lastRead = Date.now();
    let lastSeen = Date.now();
    const seen = () => {
      lastSeen = Date.now();
    };
    const wake = () => {
      lastRead = Date.now();
      wakeInstance(ownAgentId, true);
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastSeen < AWAY_MS) wake();
    }, KEEP_AWAKE_MS);
    const onShow = () => {
      if (document.visibilityState !== "visible") return;
      seen();
      if (Date.now() - lastRead >= KEEP_AWAKE_MS) wake();
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("pointerdown", seen, { passive: true });
    window.addEventListener("keydown", seen);
    return () => {
      window.removeEventListener("pointerdown", seen);
      window.removeEventListener("keydown", seen);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [ownAgentId]);

  return null;
}
