/* hooks/evals.ts — React Query hooks for a skill's ablation evals (plan Phase 3,
   ADR 0017/0018): eval cases, suites, and the polled suite detail.
   API handshake: specs/03-skill-impact-api.md ("Phase 3: Evals"). */
"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { MutationHookOptions } from "../query-client";
import { skillKeys } from "./skills";
// Value imports (ADR 0007 response validation) from the contract subpath, as
// hooks/skills.ts does, so the bundle carries this contract, not the barrel.
import {
  type CreateEvalCaseInput,
  type CreateEvalSuiteBody,
  EVAL_SUITE_TERMINAL_STATUSES,
  EvalSuite,
  EvalSuiteDetail,
  type EvalSuiteStatus,
  SkillEvalCase,
  type UpdateEvalCaseInput,
} from "@devdigest/shared/contracts/skill-impact";

/** Poll interval for a suite in flight (spec: every 2 s until terminal). */
export const EVAL_SUITE_POLL_INTERVAL_MS = 2000;

const EVAL_CASE_LIST = SkillEvalCase.array();
const EVAL_SUITE_LIST = EvalSuite.array();

/** Query keys for the eval hooks — one place so invalidation cannot drift. */
export const evalKeys = {
  cases: (skillId: string) => ["skill-eval-cases", skillId] as const,
  suites: (skillId: string) => ["skill-eval-suites", skillId] as const,
  suite: (suiteId: string) => ["eval-suite", suiteId] as const,
};

/** A suite that will never change again. */
export function isTerminalSuiteStatus(status: EvalSuiteStatus): boolean {
  return EVAL_SUITE_TERMINAL_STATUSES.includes(status);
}

/**
 * Whether the suite is doing work worth polling for. `estimated` is not
 * terminal but sits idle until someone presses Start, so it is not polled.
 */
export function isSuiteInFlight(status: EvalSuiteStatus): boolean {
  return status === "running";
}

/** Everything a finished suite changes: its verdict feeds Stats, the card and the skill header. */
function invalidateAfterSuite(qc: QueryClient, skillId: string) {
  qc.invalidateQueries({ queryKey: skillKeys.stats(skillId) });
  qc.invalidateQueries({ queryKey: skillKeys.detail(skillId) });
  qc.invalidateQueries({ queryKey: skillKeys.list });
  qc.invalidateQueries({ queryKey: evalKeys.suites(skillId) });
}

// ---- Cases ----

/** `GET /skills/:id/eval-cases`. */
export function useSkillEvalCases(skillId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.cases(skillId ?? ""),
    queryFn: () => api.get<SkillEvalCase[]>(`/skills/${skillId}/eval-cases`, EVAL_CASE_LIST),
    enabled: !!skillId,
  });
}

export interface CreateEvalCaseArgs {
  skillId: string;
  body: CreateEvalCaseInput;
}

/** `POST /skills/:id/eval-cases`. `options.meta` lets the case editor own its errors (ADR 0011). */
export function useCreateEvalCase(options?: MutationHookOptions) {
  const qc = useQueryClient();
  return useMutation({
    meta: options?.meta,
    mutationFn: ({ skillId, body }: CreateEvalCaseArgs) =>
      api.post<SkillEvalCase>(`/skills/${skillId}/eval-cases`, body, SkillEvalCase),
    onSuccess: (_data, { skillId }) => qc.invalidateQueries({ queryKey: evalKeys.cases(skillId) }),
  });
}

export interface UpdateEvalCaseArgs {
  skillId: string;
  caseId: string;
  patch: UpdateEvalCaseInput;
}

/** `PUT /eval-cases/:id` — a new `source` re-snapshots the diff server-side. */
export function useUpdateEvalCase(options?: MutationHookOptions) {
  const qc = useQueryClient();
  return useMutation({
    meta: options?.meta,
    mutationFn: ({ caseId, patch }: UpdateEvalCaseArgs) =>
      api.put<SkillEvalCase>(`/eval-cases/${caseId}`, patch, SkillEvalCase),
    onSuccess: (_data, { skillId }) => qc.invalidateQueries({ queryKey: evalKeys.cases(skillId) }),
  });
}

/** `DELETE /eval-cases/:id`. */
export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId }: { skillId: string; caseId: string }) => api.del<{ ok: boolean }>(`/eval-cases/${caseId}`),
    onSuccess: (_data, { skillId }) => qc.invalidateQueries({ queryKey: evalKeys.cases(skillId) }),
  });
}

// ---- Suites ----

/** `GET /skills/:id/eval-suites` — newest first. */
export function useSkillEvalSuites(skillId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.suites(skillId ?? ""),
    queryFn: () => api.get<EvalSuite[]>(`/skills/${skillId}/eval-suites`, EVAL_SUITE_LIST),
    enabled: !!skillId,
  });
}

/**
 * `GET /eval-suites/:id` — the polling target. Polls every 2 s while the suite
 * is running and stops on any other status (precedent: `usePrRuns` in
 * hooks/reviews.ts). The running → terminal transition is detected inside the
 * queryFn by comparing with the cached previous answer, so it fires exactly
 * once per transition, without an effect, and invalidates Stats, the skill and
 * the skills list (spec "Client cache keys touched").
 */
export function useEvalSuite(skillId: string | null | undefined, suiteId: string | null | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: evalKeys.suite(suiteId ?? ""),
    queryFn: async () => {
      const key = evalKeys.suite(suiteId ?? "");
      const prev = qc.getQueryData<EvalSuiteDetail>(key);
      const next = await api.get<EvalSuiteDetail>(`/eval-suites/${suiteId}`, EvalSuiteDetail);
      if (skillId && prev && !isTerminalSuiteStatus(prev.status) && isTerminalSuiteStatus(next.status)) {
        invalidateAfterSuite(qc, skillId);
      }
      return next;
    },
    enabled: !!suiteId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isSuiteInFlight(status) ? EVAL_SUITE_POLL_INTERVAL_MS : false;
    },
  });
}

export interface CreateEvalSuiteArgs {
  skillId: string;
  body: CreateEvalSuiteBody;
}

/**
 * `POST /skills/:id/eval-suites` — estimates a suite (`status: 'estimated'`);
 * nothing runs yet. The Run modal owns the error (trust gate, budget, no cases).
 */
export function useCreateEvalSuite(options?: MutationHookOptions) {
  const qc = useQueryClient();
  return useMutation({
    meta: options?.meta,
    mutationFn: ({ skillId, body }: CreateEvalSuiteArgs) =>
      api.post<EvalSuite>(`/skills/${skillId}/eval-suites`, body, EvalSuite),
    onSuccess: (_data, { skillId }) => qc.invalidateQueries({ queryKey: evalKeys.suites(skillId) }),
  });
}

/** Seed the detail cache from a list-shaped suite, so the poller has a "previous" to compare against. */
function seedSuiteDetail(qc: QueryClient, suite: EvalSuite) {
  const key = evalKeys.suite(suite.id);
  const prev = qc.getQueryData<EvalSuiteDetail>(key);
  qc.setQueryData<EvalSuiteDetail>(key, { cases: prev?.cases ?? [], runs: prev?.runs ?? [], ...suite });
}

/**
 * `POST /eval-suites/:id/start` (body-less; a repeat is a 200 no-op). The
 * answer seeds the detail cache as `running`, so the poller catches the
 * transition to terminal even when the suite finishes before the first poll.
 */
export function useStartEvalSuite(options?: MutationHookOptions) {
  const qc = useQueryClient();
  return useMutation({
    meta: options?.meta,
    mutationFn: ({ suiteId }: { skillId: string; suiteId: string }) =>
      api.post<EvalSuite>(`/eval-suites/${suiteId}/start`, undefined, EvalSuite),
    onSuccess: (suite, { skillId }) => {
      seedSuiteDetail(qc, suite);
      qc.invalidateQueries({ queryKey: evalKeys.suites(skillId) });
      qc.invalidateQueries({ queryKey: evalKeys.suite(suite.id) });
    },
  });
}

/** `POST /eval-suites/:id/cancel` — a terminal suite is a 200 no-op; an in-flight LLM call still bills. */
export function useCancelEvalSuite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ suiteId }: { skillId: string; suiteId: string }) =>
      api.post<EvalSuite>(`/eval-suites/${suiteId}/cancel`, undefined, EvalSuite),
    onSuccess: (_suite, { skillId, suiteId }) => {
      qc.invalidateQueries({ queryKey: evalKeys.suites(skillId) });
      qc.invalidateQueries({ queryKey: evalKeys.suite(suiteId) });
    },
  });
}
