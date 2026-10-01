/* hooks/repo-intel.ts — React Query hooks for the repo-intel (T3) index state.
   Mirrors hooks/context.ts (useIndexStatus/useReindex) but targets the
   repo-intel facade's HTTP surface:
     GET  /repos/:id/index-state  → RepoIntelState
     POST /repos/:id/resync       → fetch latest from origin + incremental
                                     reindex (202). NOT a destructive re-clone. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { MutationHookOptions } from "../query-client";
import { prBlastKey } from "./brief";
import { markOverviewIndexRunStarted } from "./overview";

/** Subset of the server's IndexState the badge + completion-poll need (kept
    local — not in @devdigest/shared, since repo-intel types live server-side). */
export interface RepoIntelState {
  status: "full" | "partial" | "degraded" | "failed";
  filesIndexed: number;
  filesSkipped: number;
  /** Advances when a resync writes a new index row → the UI's completion signal. */
  lastIndexedSha: string;
  updatedAt: string;
  degraded?: boolean;
  degradedReason?: string;
  reason?: string;
}

/** GET /repos/:id/index-state → current repo-intel index state.
    While `poll` is true, refetch on an interval so a running resync's result
    becomes visible. The caller (ProjectContextView) owns when to stop polling
    (the status enum is terminal-only, so completion is detected by watching
    `lastIndexedSha`/`updatedAt` advance, not by status). */
export function useRepoIntelStatus(repoId: string | null | undefined, poll = false) {
  return useQuery({
    queryKey: ["repo-intel-state", repoId],
    queryFn: () => api.get<RepoIntelState>(`/repos/${repoId}/index-state`),
    enabled: !!repoId,
    refetchInterval: poll ? 1500 : false,
  });
}

/** POST /repos/:id/resync → fetch latest + incremental reindex (resync, not re-clone).
    With `prId` (a PR screen that shows index-derived data) the PR's readiness is marked
    in flight and its blast is invalidated, so the screen refreshes when the run finishes. */
export function useResyncRepoIntel(
  repoId: string | null | undefined,
  options?: MutationHookOptions & { prId?: string },
) {
  const qc = useQueryClient();
  return useMutation({
    meta: options?.meta,
    mutationFn: () => api.post<{ status: string }>(`/repos/${repoId}/resync`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["repo-intel-state", repoId] });
      if (options?.prId) {
        markOverviewIndexRunStarted(qc, options.prId);
        qc.invalidateQueries({ queryKey: prBlastKey(options.prId) });
      }
    },
  });
}
