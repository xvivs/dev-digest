import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { Intent, IntentConfidence, IntentSource, Risk, SmartDiff, UnresolvedLink } from './brief.js';
import { CostSource } from './cost.js';
import { Provider } from './knowledge.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run. The
 * persisted reviews are also returned once the (synchronous) run completes.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

/**
 * Intent persisted for a PR: the Intent plus the pr_id it scopes, the head it was
 * derived for, its deterministic confidence and sources, and the cost pair
 * (`cost_usd` / `cost_source` are both null or both set, ADR 0002).
 */
export const PrIntentRecord = Intent.extend({
  pr_id: z.string(),
  head_sha: z.string().nullable(),
  confidence: IntentConfidence,
  sources: z.array(IntentSource),
  unresolved_links: z.array(UnresolvedLink),
  provider: Provider.nullable(),
  model: z.string().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  cost_source: CostSource.nullable(),
  derived_at: z.string(),
});
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

/** Why a brief derivation (intent or risks phase) failed. Single source for the enum. */
export const BriefFailureReason = z.enum([
  'provider_not_configured',
  'timeout',
  'llm_error',
  'parse_error',
  'no_pull',
  'head_moved',
  'internal',
]);
export type BriefFailureReason = z.infer<typeof BriefFailureReason>;

export const BriefFailure = z.object({
  reason: BriefFailureReason,
  at: z.string(),
});
export type BriefFailure = z.infer<typeof BriefFailure>;

/** Response of `GET /pulls/:id/intent`. */
export const PrIntentResponse = z.object({
  intent: PrIntentRecord.nullable(),
  stale: z.boolean(),
  in_flight: z.boolean(),
  last_failure: BriefFailure.nullable(),
});
export type PrIntentResponse = z.infer<typeof PrIntentResponse>;

/** Risks persisted for a PR head. `rule_only` = the LLM call failed, rules only. */
export const PrRisksRecord = z.object({
  pr_id: z.string(),
  head_sha: z.string(),
  risks: z.array(Risk),
  dropped_refs: z.number().int(),
  rule_only: z.boolean(),
  provider: Provider.nullable(),
  model: z.string().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  cost_source: CostSource.nullable(),
  derived_at: z.string(),
});
export type PrRisksRecord = z.infer<typeof PrRisksRecord>;

/** Response of `GET /pulls/:id/risks`. */
export const PrRisksResponse = z.object({
  risks: PrRisksRecord.nullable(),
  stale: z.boolean(),
  in_flight: z.boolean(),
  last_failure: BriefFailure.nullable(),
});
export type PrRisksResponse = z.infer<typeof PrRisksResponse>;

/** Response (202) of `POST /pulls/:id/brief/derive`. */
export const DeriveBriefResponse = z.object({ queued: z.boolean() });
export type DeriveBriefResponse = z.infer<typeof DeriveBriefResponse>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;
