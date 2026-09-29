import type { EvalCaseLatestResult, EvalSuite, EvalSuiteCaseResult, EvalSuiteDetail, SkillEvalCase } from "@devdigest/shared";
import type { CaseIconState } from "./constants";

/** A per-case suite (`case_ids` set): never the whole-skill result, never the verdict source. */
function isPartial(s: EvalSuite): boolean {
  return s.partial === true || (s.case_ids?.length ?? 0) > 0;
}

/** The newest started suite over the skill's whole case set: it fills the header and the verdict. */
export function wholeSkillSuite(suites: readonly EvalSuite[] | undefined): EvalSuite | null {
  return suites?.find((s) => s.status !== "estimated" && !isPartial(s)) ?? null;
}

/** A suite that is running right now (whole or per-case): only one may run per workspace. */
export function runningSuite(suites: readonly EvalSuite[] | undefined): EvalSuite | null {
  return suites?.find((s) => s.status === "running") ?? null;
}

/**
 * What the cards show, per case: its own latest settled result (server:
 * `latest-results`), overridden by the live per-case figures of a suite that
 * is running right now, for the cases that suite covers. No row = never run.
 */
export function cardResults(
  latest: readonly EvalCaseLatestResult[] | undefined,
  cases: readonly { id: string; name: string }[],
  live: Pick<EvalSuiteDetail, "cases"> | null | undefined,
): Map<string, EvalSuiteCaseResult> {
  const names = new Map(cases.map((c) => [c.id, c.name]));
  const out = new Map<string, EvalSuiteCaseResult>();
  for (const r of latest ?? []) {
    out.set(r.case_id, {
      case_id: r.case_id,
      case_name: names.get(r.case_id) ?? "",
      with: r.with,
      without: r.without,
      outcome: r.outcome,
      expected_count: r.expected_count,
      matched_median: r.matched_median,
      unexpected_median: r.unexpected_median,
      is_clean: r.is_clean,
      with_errored: r.with_errored,
    });
  }
  for (const r of live?.cases ?? []) out.set(r.case_id, r);
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
