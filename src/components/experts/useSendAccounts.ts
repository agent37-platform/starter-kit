"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { cached, cachedFetch, remember } from "@/lib/client-cache";
import { inboxOf } from "@/lib/mail";
import { sendAccounts, type SendAccount } from "@/lib/send-accounts";
import type { UnipileStatus } from "@/lib/unipile";
import type { IntegrationConnection, IntegrationConnectionsResult } from "@/lib/types";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { useExpertsContext } from "./ExpertsProvider";
import { useMailInboxes } from "./useMailInboxes";

// What « Envoyer » may offer for one expert: the accounts really plugged in (Connecteurs, the expert's
// inbox, Unipile), read once and shared with the screens that already read them. A source that cannot be
// read offers nothing; it never invents a channel.
export function useSendAccounts(agentId: string, profileId: string | null): {
  accounts: SendAccount[];
  loaded: boolean;
  myEmail: string | null;
} {
  const { userEmail } = useWorkspace();
  const { experts } = useExpertsContext();
  const expert = experts.find((e) => e.agentId === agentId && e.profileId === profileId) ?? null;
  const mail = useMailInboxes(agentId);
  const [connections, setConnections] = useState<IntegrationConnection[] | null>(() => cached<IntegrationConnection[]>(`conns:${agentId}`) ?? null);
  const [unipile, setUnipile] = useState<UnipileStatus | null | undefined>(() => cached<UnipileStatus>("unipile"));

  useEffect(() => {
    let live = true;
    cachedFetch(
      `conns:${agentId}`,
      () => apiFetch<IntegrationConnectionsResult>(`/api/agents/${agentId}/integrations/connections`).then((d) => d.connections),
      60_000
    ).then(
      (list) => live && setConnections(list),
      () => live && setConnections((prev) => prev ?? [])
    );
    cachedFetch("unipile", () => apiFetch<UnipileStatus>("/api/unipile"), 60_000).then(
      (s) => {
        remember("unipile", s);
        if (live) setUnipile(s);
      },
      () => live && setUnipile((prev) => prev ?? null)
    );
    return () => {
      live = false;
    };
  }, [agentId]);

  const inbox = expert?.catalogueKey ? inboxOf(mail.inboxes, expert.catalogueKey, agentId) : null;
  const name = expert?.displayName ?? "l’Expert";
  const accounts = useMemo(
    () => sendAccounts({ connections, inbox, unipile: unipile ?? null, profileId, expertName: name }),
    [connections, inbox, unipile, profileId, name]
  );
  return { accounts, loaded: connections !== null && unipile !== undefined && mail.loaded, myEmail: userEmail || null };
}
