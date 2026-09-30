/* hooks/conventions.ts — React Query hooks for the Conventions Extractor
   (SPEC-02-CONV). Every response goes through its zod contract in dev and test
   (ADR 0007), which is why this file is the first hook to import a schema as a
   VALUE from @devdigest/shared (next.config.mjs carries the extensionAlias).

     GET   /repos/:id/conventions          → ConventionsPage
     POST  /repos/:id/conventions/extract  → 202 {scan_id} | 409 scan_running {scan_id}
     PATCH /conventions/:id                → ConventionCandidate
     POST  /repos/:id/conventions/skills   → 201 {skill, linked_agent_ids} */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConventionCandidate, ConventionsPage, CreateSkillFromConventionsResponse } from "@devdigest/shared";
import type { CreateSkillFromConventionsBody, UpdateConventionBody } from "@devdigest/shared";
import { api, ApiError } from "../api";
import type { MutationHookOptions } from "../query-client";
import type { ErrorInfo } from "../types";

/** Poll cadence while a scan runs (the job takes tens of seconds, D2). */
const SCAN_POLL_MS = 2000;
/** Server code for "a scan is already running for this repo" (AC-2). */
const SCAN_RUNNING_CODE = "scan_running";
const CONFLICT_STATUS = 409;
/** Shared by every convention PATCH so an in-flight one is discoverable (`isMutating`). */
const UPDATE_MUTATION_KEY = ["convention-update"] as const;

const conventionsKey = (repoId: string | null | undefined) => ["conventions", repoId] as const;

/**
 * GET /repos/:id/conventions. Polls only while the page reports a
 * `running_scan`, and never while a decision is in flight: a refetch landing
 * mid-mutation would overwrite the optimistic card (AC-36).
 */
export function useConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: conventionsKey(repoId),
    queryFn: () => api.get<ConventionsPage>(`/repos/${repoId}/conventions`, ConventionsPage),
    enabled: !!repoId,
    refetchInterval: (query) =>
      query.state.data?.running_scan && qc.isMutating({ mutationKey: UPDATE_MUTATION_KEY }) === 0
        ? SCAN_POLL_MS
        : false,
  });
}

export interface ExtractConventionsResult {
  scan_id: string;
  /** True when a scan was already running and this call attached to it (AC-41). */
  attached: boolean;
}

/**
 * A failed request as plain data (`null` when there is no error), so the
 * Conventions screens classify errors without importing `ApiError`.
 */
export function errorInfo(err: unknown): ErrorInfo | null {
  if (!err) return null;
  if (err instanceof ApiError) return { message: err.message, status: err.status, code: err.code, details: err.details };
  return { message: err instanceof Error ? err.message : "" };
}

/** The running scan's id out of a 409 `scan_running` error, else null. */
export function runningScanId(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== CONFLICT_STATUS || err.code !== SCAN_RUNNING_CODE) return null;
  const details = err.details;
  if (typeof details !== "object" || details === null || !("scan_id" in details)) return null;
  return typeof details.scan_id === "string" ? details.scan_id : null;
}

/**
 * POST /repos/:id/conventions/extract. A 409 `scan_running` is not a failure:
 * it resolves with the winner's scan id so the page attaches to it, with no
 * error surface at all (AC-41). Other failures reach the call site, which
 * opts into `errorSurface: "local"` (ADR 0011) to render them inline.
 */
export function useExtractConventions(repoId: string | null | undefined, options?: MutationHookOptions) {
  const qc = useQueryClient();
  return useMutation({
    meta: options?.meta,
    mutationFn: async (): Promise<ExtractConventionsResult> => {
      try {
        const res = await api.post<{ scan_id: string }>(`/repos/${repoId}/conventions/extract`);
        return { scan_id: res.scan_id, attached: false };
      } catch (err) {
        const scanId = runningScanId(err);
        if (scanId) return { scan_id: scanId, attached: true };
        throw err;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: conventionsKey(repoId) }),
  });
}

export interface UpdateConventionInput {
  id: string;
  patch: UpdateConventionBody;
}

/** The page with one candidate patched the way the server will patch it. */
function withPatchedCandidate(page: ConventionsPage, { id, patch }: UpdateConventionInput): ConventionsPage {
  return {
    ...page,
    candidates: page.candidates.map((c) => {
      if (c.id !== id) return c;
      const rule = patch.rule ?? c.rule;
      return {
        ...c,
        status: patch.status ?? c.status,
        category: patch.category ?? c.category,
        rule,
        edited: c.edited || rule !== c.original_rule,
      };
    }),
  };
}

/**
 * PATCH /conventions/:id with an optimistic update (AC-36, AC-37): the card
 * moves tabs at once, the counts follow, and a failure rolls the page back.
 * `cancelQueries` keeps an in-flight refetch from overwriting the guess.
 */
export function useUpdateConvention(repoId: string | null | undefined, options?: MutationHookOptions) {
  const qc = useQueryClient();
  const key = conventionsKey(repoId);
  return useMutation({
    mutationKey: UPDATE_MUTATION_KEY,
    meta: options?.meta,
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch, ConventionCandidate),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ConventionsPage>(key);
      qc.setQueryData<ConventionsPage>(key, (page) => (page ? withPatchedCandidate(page, input) : page));
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSuccess: (candidate) => {
      qc.setQueryData<ConventionsPage>(key, (page) =>
        page ? { ...page, candidates: page.candidates.map((c) => (c.id === candidate.id ? candidate : c)) } : page,
      );
    },
    onSettled: () => {
      // Reconcile with the server once the last concurrent decision settles.
      if (qc.isMutating({ mutationKey: UPDATE_MUTATION_KEY }) === 1) qc.invalidateQueries({ queryKey: key });
    },
  });
}

/**
 * POST /repos/:id/conventions/skills. The modal shows 409 `skill_name_taken`
 * and 422 budget errors itself, so it passes `errorSurface: "local"`.
 */
export function useCreateSkillFromConventions(repoId: string | null | undefined, options?: MutationHookOptions) {
  const qc = useQueryClient();
  return useMutation({
    meta: options?.meta,
    mutationFn: (body: CreateSkillFromConventionsBody) =>
      api.post<CreateSkillFromConventionsResponse>(
        `/repos/${repoId}/conventions/skills`,
        body,
        CreateSkillFromConventionsResponse,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agent-skills"] });
      qc.invalidateQueries({ queryKey: conventionsKey(repoId) });
    },
  });
}
