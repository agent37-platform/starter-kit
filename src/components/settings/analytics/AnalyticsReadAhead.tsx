"use client";

import { useEffect } from "react";
import { useOwnAgentId } from "@/components/conversations/useAllConversations";
import { DEFAULT_QUERY } from "@/lib/analytics/query";
import { loadAnalytics } from "./useAnalytics";

// Charge l'analytique de l'instance du membre dès l'ouverture de l'app, pour la requête par défaut.
export function AnalyticsReadAhead() {
  const ownAgentId = useOwnAgentId();

  useEffect(() => {
    if (ownAgentId) loadAnalytics(ownAgentId, DEFAULT_QUERY).catch(() => {});
  }, [ownAgentId]);

  return null;
}
