import { z } from 'zod';
import { BriefFailure } from './review-api.js';

/**
 * Overview "Prepare overview" (spec 06): readiness of clone, repo-intel index
 * and brief for one PR, plus the steps `POST /pulls/:id/overview/prepare`
 * would start. The plan is computed on the server; the client only renders it.
 */

export const OverviewIndexStatus = z.enum([
  'full',
  'stale',
  'partial',
  'degraded',
  'outdated',
  'missing',
  'no_head',
  'no_clone',
  'flag_off',
]);
export type OverviewIndexStatus = z.infer<typeof OverviewIndexStatus>;

export const OverviewBriefStatus = z.enum(['fresh', 'stale', 'missing']);
export type OverviewBriefStatus = z.infer<typeof OverviewBriefStatus>;

/** Steps Prepare starts on its own when they are missing. */
export const PrepareAction = z.enum(['clone', 'index_full', 'index_incremental', 'derive_brief']);
export type PrepareAction = z.infer<typeof PrepareAction>;

/** Steps that run only when the request asks for them explicitly. */
export const ExplicitAction = z.enum(['reindex_partial']);
export type ExplicitAction = z.infer<typeof ExplicitAction>;

export const PartialReason = z.enum(['soft_budget', 'graph_failed', 'parse_errors', 'no_files']);
export type PartialReason = z.infer<typeof PartialReason>;

/** Why the last clone job failed: a safe classification, never the raw git message. */
export const CloneFailureReason = z.enum(['not_found', 'auth', 'network', 'unknown']);
export type CloneFailureReason = z.infer<typeof CloneFailureReason>;

/** Body of `POST /pulls/:id/overview/prepare`. Any other key is rejected. */
export const PrepareOverviewRequest = z
  .object({
    reindex_partial: z.boolean().optional(),
  })
  .strict();
export type PrepareOverviewRequest = z.infer<typeof PrepareOverviewRequest>;

/** Response of `GET /pulls/:id/overview/readiness`. */
export const PrOverviewReadiness = z.object({
  pr_id: z.string(),
  repo_id: z.string(),
  clone: z.object({
    status: z.enum(['cloned', 'missing']),
    in_flight: z.boolean(),
    /** Last failed clone job; in-memory, so `null` again after an API restart (ADR 0020). */
    last_failure: z.object({ reason: CloneFailureReason, at: z.string() }).nullable(),
  }),
  index: z.object({
    status: OverviewIndexStatus,
    in_flight: z.boolean(),
    /** ISO time of the last run that re-read the clone; `null` = never or not recorded. */
    last_indexed_at: z.string().nullable(),
    /** `null` when there is no index row or its sha is empty. */
    last_indexed_sha: z.string().nullable(),
    partial_reason: PartialReason.nullable(),
  }),
  brief: z.object({
    intent: OverviewBriefStatus,
    risks: OverviewBriefStatus,
    in_flight: z.boolean(),
    intent_failure: BriefFailure.nullable(),
    risks_failure: BriefFailure.nullable(),
  }),
  blocked_by: z.enum(['head_moved', 'provider_not_configured']).nullable(),
  actions: z.array(PrepareAction),
  explicit_actions: z.array(ExplicitAction),
  /** `clone.in_flight || index.in_flight || brief.in_flight`. */
  in_flight: z.boolean(),
});
export type PrOverviewReadiness = z.infer<typeof PrOverviewReadiness>;

/** Response of `POST /pulls/:id/overview/prepare` (202). */
export const PrepareOverviewResponse = z.object({
  status: z.enum(['started', 'skipped']),
  started: z.array(z.union([PrepareAction, ExplicitAction])),
  failed: z.array(z.union([PrepareAction, ExplicitAction])),
  readiness: PrOverviewReadiness,
});
export type PrepareOverviewResponse = z.infer<typeof PrepareOverviewResponse>;
