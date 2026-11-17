"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { cached, cachedFetch, forget } from "@/lib/client-cache";
import { inboxOf, type CreateMailInboxInput, type MailInbox } from "@/lib/mail";
import { useWorkspace } from "@/components/WorkspaceProvider";

interface MailInboxesPayload {
  items: MailInbox[];
  enabled: boolean;
}

// The inboxes of the experts of the member's instance, and whether the mail module is on for the
// workspace. Starts from the last reading so the E-mails tab does not flicker in and out.
export function useMailInboxes(agentId: string): {
  inboxes: MailInbox[];
  enabled: boolean;
  loaded: boolean;
  reload: () => Promise<void>;
  createInbox: (input: Omit<CreateMailInboxInput, "agentId">) => Promise<MailInbox>;
  deleteInbox: (expert: string) => Promise<void>;
} {
  const { userEmail, current } = useWorkspace();
  const key = `mail-inboxes:${userEmail}:${current?.id ?? ""}:${agentId}`;
  const [state, setState] = useState<{ key: string; inboxes: MailInbox[]; enabled: boolean } | null>(() => {
    const kept = cached<MailInboxesPayload | MailInbox[]>(key);
    if (!kept || Array.isArray(kept)) return null;
    return { key, inboxes: kept.items, enabled: kept.enabled };
  });

  // Read once for the shell, kept two minutes (an expert's space opened again asks nothing); `reload` asks anew.
  const read = useCallback(
    async (fresh: boolean) => {
      if (fresh) forget(key);
      try {
        const data = await cachedFetch(
          key,
          () =>
            apiFetch<{ items: MailInbox[]; enabled?: boolean }>(`/api/mail/inboxes?agentId=${encodeURIComponent(agentId)}`).then((d) => ({
              items: d.items,
              enabled: d.enabled ?? d.items.length > 0,
            })),
          120_000
        );
        setState({ key, inboxes: data.items, enabled: data.enabled });
      } catch {
        setState((prev) => (prev?.key === key ? prev : { key, inboxes: [], enabled: false }));
      }
    },
    [key, agentId]
  );
  const reload = useCallback(() => read(true), [read]);

  const createInbox = useCallback(
    async (input: Omit<CreateMailInboxInput, "agentId">): Promise<MailInbox> => {
      const { inbox } = await apiFetch<{ inbox: MailInbox }>("/api/mail/inboxes", {
        method: "POST",
        body: JSON.stringify({ ...input, agentId }),
      });
      forget(key);
      setState((prev) => {
        const items = prev?.key === key ? prev.inboxes : [];
        const known = inboxOf(items, inbox.expert, agentId);
        return { key, inboxes: known ? items.map((i) => (i === known ? inbox : i)) : [...items, inbox], enabled: true };
      });
      return inbox;
    },
    [key, agentId]
  );

  const deleteInbox = useCallback(
    async (expert: string): Promise<void> => {
      await apiFetch<{ deleted: boolean }>(`/api/mail/inboxes?${new URLSearchParams({ expert, agentId }).toString()}`, { method: "DELETE" });
      forget(key);
      setState((prev) => {
        const items = prev?.key === key ? prev.inboxes : [];
        const gone = inboxOf(items, expert, agentId);
        return { key, inboxes: items.filter((i) => i !== gone), enabled: true };
      });
    },
    [key, agentId]
  );

  useEffect(() => {
    void read(false);
  }, [read]);

  const mine = state?.key === key ? state : null;
  return { inboxes: mine?.inboxes ?? [], enabled: mine?.enabled ?? false, loaded: mine !== null, reload, createInbox, deleteInbox };
}
