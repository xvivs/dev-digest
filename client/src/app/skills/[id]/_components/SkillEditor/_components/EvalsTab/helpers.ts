import type { EvalSuite, SkillEvalCase } from "@devdigest/shared";

/**
 * The suite the tab reports on: the newest one that was started. An
 * `estimated` suite is only a price quote (the Run modal may leave several
 * behind), so it never replaces the last real result.
 */
export function latestStartedSuite(suites: readonly EvalSuite[] | undefined): EvalSuite | null {
  return suites?.find((s) => s.status !== "estimated") ?? null;
}

/** Cases a suite would run: legacy rows whose expectations do not parse are skipped server-side. */
export function runnableCaseCount(cases: readonly SkillEvalCase[] | undefined): number {
  return cases?.filter((c) => c.expectation !== null).length ?? 0;
}

/** Why "Run all" is disabled, as a `skillEvals.*` message key, or null when it can run. */
export function runBlockedReason(runnable: number, suite: EvalSuite | null): "runBlockedRunning" | "runBlockedNoCases" | null {
  if (suite?.status === "running") return "runBlockedRunning";
  if (runnable === 0) return "runBlockedNoCases";
  return null;
}
