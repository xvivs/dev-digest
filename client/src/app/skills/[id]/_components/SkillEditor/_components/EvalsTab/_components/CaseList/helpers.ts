import type { EvalSuiteRun } from "@devdigest/shared";

function meanUnexpected(runs: readonly EvalSuiteRun[]): number | null {
  const values = runs.map((r) => r.unexpected).filter((u): u is number => u != null);
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * Per-case Δunexpected: mean unexpected findings per finished repeat with the
 * skill minus without it. Null until both arms have at least one scored run.
 */
export function caseUnexpectedDelta(runs: readonly EvalSuiteRun[], caseId: string): number | null {
  const mine = runs.filter((r) => r.case_id === caseId && r.status === "done");
  const withArm = meanUnexpected(mine.filter((r) => r.arm === "with"));
  const withoutArm = meanUnexpected(mine.filter((r) => r.arm === "without"));
  return withArm == null || withoutArm == null ? null : withArm - withoutArm;
}

/** Error text of the first failed run of a case (timeout, provider error, cancel), or null. */
export function caseErrorMessage(runs: readonly EvalSuiteRun[], caseId: string): string | null {
  const failed = runs.find((r) => r.case_id === caseId && r.status === "failed" && r.error);
  return failed?.error ?? null;
}
