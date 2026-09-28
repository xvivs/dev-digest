/* blockers.ts — client copy of the server's blocker rule. Pure, no React.

   Source of truth: `countBlockers` in reviewer-core/src/output/to-review.ts,
   called by server/src/modules/reviews/run-executor.ts when a run completes
   and stored on the run row (`RunSummary.blockers`). Prefer that stored value
   wherever a run row is at hand; use this helper only when all you hold is the
   findings. Keep the two rules identical. */
import type { CiFailOn, Finding } from "@devdigest/shared";

/** Severity rank, higher = worse (mirrors reviewer-core `SEV_RANK`). */
const SEVERITY_RANK: Record<Finding["severity"], number> = {
  SUGGESTION: 1,
  WARNING: 2,
  CRITICAL: 3,
};

/** Minimum rank that trips the gate per policy (mirrors `FAIL_ON_MIN_RANK`). */
const FAIL_ON_MIN_RANK: Record<CiFailOn, number> = {
  never: Number.POSITIVE_INFINITY,
  critical: 3,
  warning: 2,
  any: 1,
};

/** The server's default `ci_fail_on` for an agent. */
export const DEFAULT_CI_FAIL_ON: CiFailOn = "critical";

/**
 * How many findings trip the agent's CI gate: severity rank ≥ the gate
 * minimum. `never` → always 0.
 *
 * Like the server, this ignores `dismissed_at`: the stored count is taken when
 * the run completes and never goes down when a finding is dismissed later.
 */
export function countBlockers(
  findings: readonly Pick<Finding, "severity">[],
  failOn: CiFailOn = DEFAULT_CI_FAIL_ON,
): number {
  const min = FAIL_ON_MIN_RANK[failOn];
  return findings.reduce((n, f) => n + (SEVERITY_RANK[f.severity] >= min ? 1 : 0), 0);
}
