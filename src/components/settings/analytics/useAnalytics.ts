"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { cached, cachedFetch, subscribe } from "@/lib/client-cache";
import { queryString, type AnalyticsQuery } from "@/lib/analytics/query";
import type { AnalyticsOverview } from "@/lib/analytics/types";

// Chargement de l'analytique d'une instance pour une requête (période, regroupement, filtres), mis en
// cache côté client et relu en arrière-plan quand il a plus de FRESH_MS.

const FRESH_MS = 60_000;

const keyOf = (agentId: string, query: AnalyticsQuery) => `analytics:${agentId}:${queryString(query)}`;

export function loadAnalytics(agentId: string, query: AnalyticsQuery): Promise<AnalyticsOverview> {
  return cachedFetch(keyOf(agentId, query), () => apiFetch<AnalyticsOverview>(`/api/agents/${agentId}/analytics?${queryString(query)}`), FRESH_MS);
}

export function useAnalytics(agentId: string | null, query: AnalyticsQuery) {
  const key = agentId ? keyOf(agentId, query) : null;
  const [data, setData] = useState<AnalyticsOverview | null>(() => (key ? cached<AnalyticsOverview>(key) ?? null : null));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!agentId) return;
    setError(null);
    try {
      setData(await loadAnalytics(agentId, query));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible");
    }
  }, [agentId, query]);

  useEffect(() => {
    if (!key) return;
    const known = cached<AnalyticsOverview>(key);
    if (known) setData(known);
    void load();
    return subscribe<AnalyticsOverview>(key, setData);
  }, [key, load]);

  return { data, error };
}
