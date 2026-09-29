import type { EvalArm, EvalCaseArmDetail, EvalCaseRunDetail, EvalCaseUnexpectedFinding } from "@devdigest/shared";

export type MustFindMark = { kind: "matched" } | { kind: "missed" } | { kind: "partial"; hit: number; done: number } | { kind: "none" };

/**
 * How one must_find row fared across the with-skill repeats that finished.
 * `index` points into the case's must_find (server-side matcher, same as scoring).
 */
export function mustFindMark(index: number, withRuns: readonly EvalCaseRunDetail[]): MustFindMark {
  const done = withRuns.filter((r) => r.status === "done");
  if (done.length === 0) return { kind: "none" };
  const hit = done.filter((r) => r.matched_must_find.includes(index)).length;
  if (hit === done.length) return { kind: "matched" };
  return hit === 0 ? { kind: "missed" } : { kind: "partial", hit, done: done.length };
}

/** Seconds with one decimal ("1.2"), or null when the run has no duration. */
export function formatDuration(ms: number | null): string | null {
  return ms == null ? null : (ms / 1000).toFixed(1);
}

export interface UnexpectedGroup {
  arm: EvalArm;
  repeat_idx: number;
  findings: readonly EvalCaseUnexpectedFinding[];
  /** Findings counted on the run but cut from the list (server caps the list). */
  hidden: number;
}

/** Runs that produced unexpected findings, with-arm first. */
export function unexpectedGroups(arms: Record<EvalArm, EvalCaseArmDetail>): UnexpectedGroup[] {
  const out: UnexpectedGroup[] = [];
  for (const arm of ["with", "without"] as const) {
    for (const r of arms[arm].runs) {
      if (r.unexpected_findings.length === 0) continue;
      out.push({ arm, repeat_idx: r.repeat_idx, findings: r.unexpected_findings, hidden: Math.max(0, (r.unexpected ?? 0) - r.unexpected_findings.length) });
    }
  }
  return out;
}
