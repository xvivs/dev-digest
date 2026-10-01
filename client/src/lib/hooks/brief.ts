/* hooks/brief.ts — React Query hooks for the PR overview (ADR 0022/0023):
   derived intent + risks, blast radius, prior-PR history.
     GET  /pulls/:id/intent | /risks | /blast | /history
     POST /pulls/:id/brief/derive  → 202 { queued }
   The mutation has no local toast: the global MutationCache.onError reports it. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { MutationHookOptions } from "../query-client";
import {
  DeriveBriefResponse,
  PrBlastResponse,
  PrHistoryResponse,
  PrIntentResponse,
  PrRisksResponse,
} from "@devdigest/shared";

/** Poll interval while a derivation is in flight server-side. */
const BRIEF_POLL_INTERVAL_MS = 2000;
const BLAST_STALE_TIME_MS = 60_000;
const HISTORY_STALE_TIME_MS = 5 * 60_000;

/** Derived intent for a PR. Polls while `in_flight`. */
export function usePrIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-intent", prId],
    queryFn: () => api.get<PrIntentResponse>(`/pulls/${prId}/intent`, PrIntentResponse),
    enabled: !!prId,
    refetchInterval: (query) => (query.state.data?.in_flight ? BRIEF_POLL_INTERVAL_MS : false),
  });
}

/** Risk areas for a PR. Polls while `in_flight`. */
export function usePrRisks(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-risks", prId],
    queryFn: () => api.get<PrRisksResponse>(`/pulls/${prId}/risks`, PrRisksResponse),
    enabled: !!prId,
    refetchInterval: (query) => (query.state.data?.in_flight ? BRIEF_POLL_INTERVAL_MS : false),
  });
}

/** On-demand derive (intent + risks). Invalidates both so polling starts at once. */
export function useDeriveBrief(prId: string | null | undefined, options?: MutationHookOptions) {
  const qc = useQueryClient();
  return useMutation({
    meta: options?.meta,
    mutationFn: () => api.post<DeriveBriefResponse>(`/pulls/${prId}/brief/derive`, undefined, DeriveBriefResponse),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pr-intent", prId] });
      qc.invalidateQueries({ queryKey: ["pr-risks", prId] });
      // The Prepare button's plan changes with the brief (spec 06 D13).
      qc.invalidateQueries({ queryKey: ["pr-overview-readiness", prId] });
    },
  });
}

/** `head_moved` recovery: refetching the PR detail refreshes `head_sha` and the server schedules the derive. */
export function useRefreshPullForBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  // Sequential on purpose: the detail GET persists the new head, and only then
  // do intent/risks stop reporting `head_moved` for the old one.
  return async () => {
    await qc.invalidateQueries({ queryKey: ["pull", prId] });
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["pr-intent", prId] }),
      qc.invalidateQueries({ queryKey: ["pr-risks", prId] }),
      // Clears the `head_moved` block on the Prepare button (spec 06 D13).
      qc.invalidateQueries({ queryKey: ["pr-overview-readiness", prId] }),
    ]);
  };
}

export const prBlastKey = (prId: string | null | undefined) => ["pr-blast", prId] as const;

export function usePrBlast(prId: string | null | undefined) {
  return useQuery({
    queryKey: prBlastKey(prId),
    queryFn: () => api.get<PrBlastResponse>(`/pulls/${prId}/blast`, PrBlastResponse),
    enabled: !!prId,
    staleTime: BLAST_STALE_TIME_MS,
  });
}

export function usePrHistory(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-history", prId],
    queryFn: () => api.get<PrHistoryResponse>(`/pulls/${prId}/history`, PrHistoryResponse),
    enabled: !!prId,
    staleTime: HISTORY_STALE_TIME_MS,
  });
}
