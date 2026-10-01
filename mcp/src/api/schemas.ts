/**
 * Narrow views of the shared contracts (D4): each schema picks only the fields
 * a tool reads, so an unrelated server change (a new finding kind, a new agent
 * provider) cannot break a tool. zod 3 `.pick()` is shallow, so nested objects
 * are re-picked through `.extend()`. Objects strip unknown keys by default.
 *
 * The only runtime import of `@devdigest/shared` in this package. These schemas
 * parse API JSON only; they are never handed to the MCP SDK.
 */
import { z } from 'zod';
import {
  Agent,
  BlastRadius,
  ConventionCandidate,
  ConventionEvidence,
  ConventionScan,
  FindingRecord,
  PrBlastResponse,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
  ReviewRunTarget,
  RunSummary,
} from '@devdigest/shared';

export const RepoLite = Repo.pick({ id: true, full_name: true });
export type RepoLite = z.infer<typeof RepoLite>;

export const PrLite = PrMeta.pick({ id: true, number: true });
export type PrLite = z.infer<typeof PrLite>;

export const AgentLite = Agent.pick({
  id: true,
  name: true,
  description: true,
  model: true,
  enabled: true,
});
export type AgentLite = z.infer<typeof AgentLite>;

export const RunLite = RunSummary.pick({
  run_id: true,
  agent_id: true,
  agent_name: true,
  status: true,
  error: true,
  duration_ms: true,
  findings_count: true,
  cost_usd: true,
  ran_at: true,
});
export type RunLite = z.infer<typeof RunLite>;

export const StartReviewLite = ReviewRunResponse.pick({ pr_id: true }).extend({
  runs: z.array(ReviewRunTarget.pick({ run_id: true, agent_id: true, agent_name: true })),
});
export type StartReviewLite = z.infer<typeof StartReviewLite>;

export const FindingLite = FindingRecord.pick({
  severity: true,
  title: true,
  file: true,
  start_line: true,
  end_line: true,
  rationale: true,
  suggestion: true,
  confidence: true,
  accepted_at: true,
  dismissed_at: true,
}).extend({
  // Pass-through field: relaxed so a new category cannot break a tool (D4).
  category: z.string(),
});
export type FindingLite = z.infer<typeof FindingLite>;

export const ReviewLite = ReviewRecord.pick({
  id: true,
  run_id: true,
  agent_name: true,
  verdict: true,
  summary: true,
  score: true,
  created_at: true,
}).extend({
  findings: z.array(FindingLite),
});
export type ReviewLite = z.infer<typeof ReviewLite>;

export const ConventionsLite = z.object({
  last_scan: ConventionScan.pick({ status: true, finished_at: true }).nullable(),
  candidates: z.array(
    ConventionCandidate.pick({ status: true, rule: true, confidence: true }).extend({
      category: z.string(),
      evidence: z.array(ConventionEvidence.pick({ path: true, line_start: true })),
    }),
  ),
});
export type ConventionsLite = z.infer<typeof ConventionsLite>;
export type ConventionCandidateLite = ConventionsLite['candidates'][number];

/** `GET /pulls/:id/blast`, projected 1:1: the tool drops cached/computed_at/index_status. */
export const PrBlastLite = PrBlastResponse.pick({
  status: true,
  reason: true,
  head_sha: true,
  source_sha: true,
  truncated: true,
}).extend({ blast: BlastRadius.nullable() });
export type PrBlastLite = z.infer<typeof PrBlastLite>;
