import type { EvalSuite, EvalSuiteCaseResult, EvalSuiteDetail, SkillEvalCase } from "@devdigest/shared";
import type { CaseIconState } from "./constants";

/** A per-case suite (`case_ids` set): never the whole-skill result, never the verdict source. */
function isPartial(s: EvalSuite): boolean {
  return s.partial === true || (s.case_ids?.length ?? 0) > 0;
}

/** The newest started suite over the skill's whole case set: it fills the header and the verdict. */
export function wholeSkillSuite(suites: readonly EvalSuite[] | undefined): EvalSuite | null {
  return suites?.find((s) => s.status !== "estimated" && !isPartial(s)) ?? null;
}

/**
 * The newest started per-case suite that is newer than the whole-skill one (the
 * list is newest first): its case overrides the card of that case only.
 */
export function newerPartialSuite(suites: readonly EvalSuite[] | undefined): EvalSuite | null {
  for (const s of suites ?? []) {
    if (s.status === "estimated") continue;
    if (!isPartial(s)) return null;
    return s;
  }
  return null;
}

/** A suite that is running right now (whole or per-case): only one may run per workspace. */
export function runningSuite(suites: readonly EvalSuite[] | undefined): EvalSuite | null {
  return suites?.find((s) => s.status === "running") ?? null;
}

/** Per-case result for the cards: the whole-skill suite, overridden by a newer per-case suite for its case. */
export function mergeCaseResults(
  whole: Pick<EvalSuiteDetail, "cases"> | null | undefined,
  partial: Pick<EvalSuiteDetail, "cases"> | null | undefined,
): Map<string, EvalSuiteCaseResult> {
  const out = new Map<string, EvalSuiteCaseResult>();
  for (const r of whole?.cases ?? []) out.set(r.case_id, r);
  for (const r of partial?.cases ?? []) out.set(r.case_id, r);
  return out;
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

/** The card's status icon: the with-skill result of the case in the suite that ran it. */
export function caseIconState(result: Pick<EvalSuiteCaseResult, "outcome" | "with"> | null): CaseIconState {
  if (!result) return "never";
  if (result.outcome === "error") return "error";
  if (result.outcome === "flaky") return "flaky";
  if (result.outcome === "pending") return "pending";
  return result.with.total > 0 && result.with.passed === result.with.total ? "pass" : "fail";
}

export type PassingBadgeTone = "neutral" | "ok" | "warn" | "crit";

/**
 * The header's "P / T passing" badge. Nothing settled (total 0, e.g. the only
 * case errored) has no ratio to colour, so it is neutral and reads "— passing".
 * Otherwise: all passing ok, some failing warn, none passing crit.
 */
export function passingBadge(results: { passing: number; total: number; errored: number }): {
  tone: PassingBadgeTone;
  label: "none" | "ratio";
  errored: number;
} {
  const { passing, total, errored } = results;
  if (total === 0) return { tone: "neutral", label: "none", errored };
  const tone = passing >= total ? "ok" : passing === 0 ? "crit" : "warn";
  return { tone, label: "ratio", errored };
}
