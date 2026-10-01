/* hooks/overview.ts — React Query hooks for the Overview "Prepare overview"
   button (spec 06 D13).
     GET  /pulls/:id/overview/readiness → PrOverviewReadiness (polled while in flight)
     POST /pulls/:id/overview/prepare   → 202 PrepareOverviewResponse
   The mutation has no local toast: the global MutationCache.onError reports it. */
"use client";

import { useLayoutEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { MutationHookOptions } from "../query-client";
import {
  PrepareOverviewResponse,
  PrOverviewReadiness,
  type PrepareOverviewRequest,
} from "@devdigest/shared";

/** Poll interval while clone, index or brief is in flight. */
export const OVERVIEW_READINESS_POLL_MS = 2000;

export const overviewReadinessKey = (prId: string | null | undefined) => ["pr-overview-readiness", prId] as const;

/** Called after each readiness fetch with the previous cached answer (if any). */
export type OnReadiness = (prev: PrOverviewReadiness | undefined, next: PrOverviewReadiness) => void;

/** Everything a finished prepare can have changed. */
function invalidateAfterPrepare(qc: QueryClient, prId: string, repoId: string): void {
  qc.invalidateQueries({ queryKey: ["pr-intent", prId] });
  qc.invalidateQueries({ queryKey: ["pr-risks", prId] });
  qc.invalidateQueries({ queryKey: ["pr-blast", prId] });
  qc.invalidateQueries({ queryKey: ["repo-intel-state", repoId] });
  // A clone changes `clone_path` on the repo list.
  qc.invalidateQueries({ queryKey: ["repos"] });
}

/**
 * An index run was just enqueued for this PR's repo (e.g. a Resync from the blast card).
 * Marks the cached readiness as in flight and refetches it: the poll then sees
 * in_flight -> idle and invalidates the dependent queries (blast included), even when the
 * job finishes before the first poll. No-op on an empty cache; the refetch still runs.
 */
export function markOverviewIndexRunStarted(qc: QueryClient, prId: string): void {
  qc.setQueryData<PrOverviewReadiness>(
    overviewReadinessKey(prId),
    (o) => o && { ...o, in_flight: true, index: { ...o.index, in_flight: true } },
  );
  qc.invalidateQueries({ queryKey: overviewReadinessKey(prId) });
}

/**
 * Readiness of a PR's Overview. Polls every 2 s while `in_flight`. The in
 * flight → idle transition is caught inside the queryFn by comparing with the
 * cached previous answer (precedent `useEvalSuite`), so the dependent queries
 * are invalidated exactly once, without an effect. `onReadiness` runs after
 * every fetch from the same place; it is held in a ref so the key never changes.
 */
export function usePrOverviewReadiness(prId: string | null | undefined, opts: { onReadiness?: OnReadiness } = {}) {
  const qc = useQueryClient();
  const onReadinessRef = useRef<OnReadiness | undefined>(opts.onReadiness);
  useLayoutEffect(() => {
    onReadinessRef.current = opts.onReadiness;
  });
  return useQuery({
    queryKey: overviewReadinessKey(prId),
    queryFn: async () => {
      const prev = qc.getQueryData<PrOverviewReadiness>(overviewReadinessKey(prId));
      const next = await api.get<PrOverviewReadiness>(`/pulls/${prId}/overview/readiness`, PrOverviewReadiness);
      if (prId && prev?.in_flight && !next.in_flight) invalidateAfterPrepare(qc, prId, next.repo_id);
      onReadinessRef.current?.(prev, next);
      return next;
    },
    enabled: !!prId,
    refetchInterval: (query) => (query.state.data?.in_flight ? OVERVIEW_READINESS_POLL_MS : false),
  });
}

/**
 * Prepare overview. The variable is the request body (`{}` or
 * `{ reindex_partial: true }`). On success the response's readiness seeds the
 * cache (so a job that ends before the first poll still yields a transition)
 * and intent/risks are invalidated so their own polling starts.
 */
export function usePrepareOverview(prId: string | null | undefined, options?: MutationHookOptions) {
  const qc = useQueryClient();
  return useMutation({
    meta: options?.meta,
    mutationFn: (body: PrepareOverviewRequest) =>
      api.post<PrepareOverviewResponse>(`/pulls/${prId}/overview/prepare`, body, PrepareOverviewResponse),
    onSuccess: (res) => {
      qc.setQueryData(overviewReadinessKey(prId), res.readiness);
      qc.invalidateQueries({ queryKey: ["pr-intent", prId] });
      qc.invalidateQueries({ queryKey: ["pr-risks", prId] });
    },
  });
}
