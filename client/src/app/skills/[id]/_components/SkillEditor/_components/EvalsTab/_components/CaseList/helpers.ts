import type { EvalCaseOutcome, EvalExpectation, EvalSuiteCaseResult, Severity, FindingCategory } from "@devdigest/shared";
import { CHIP_OUTCOMES } from "./constants";

export type CaseTag = { kind: "defect"; severity: Severity; category: FindingCategory; more: number } | { kind: "clean" } | null;

/** Grey tag: severity · category of the first must_find (+ how many more), "empty []" for a clean case, none for legacy. */
export function caseTag(exp: EvalExpectation | null): CaseTag {
  if (!exp) return null;
  const [first, ...rest] = exp.must_find;
  if (!first) return { kind: "clean" };
  return { kind: "defect", severity: first.min_severity, category: first.category, more: rest.length };
}

export type CaseSubtitle =
  | { kind: "never" }
  | { kind: "pending" }
  | { kind: "error" }
  | { kind: "defect"; expected: number; matched: number; errored: number }
  | { kind: "clean"; got: number; errored: number };

/**
 * Second line of the card. Figures ("matched X" / "got X") appear only when
 * the server scored at least one with-arm repeat (its medians are null
 * otherwise); with no scored repeat the line says why: run failed / running.
 * A partly errored case keeps its figure and adds the errored count.
 */
export function caseSubtitle(result: EvalSuiteCaseResult | null): CaseSubtitle {
  if (!result) return { kind: "never" };
  const expected = result.expected_count;
  const errored = result.with_errored ?? 0;
  const clean = result.is_clean === true || expected === 0;
  const scored = clean ? result.unexpected_median != null : result.matched_median != null;
  if (expected == null || !scored) return { kind: result.outcome === "error" ? "error" : "pending" };
  if (clean) return { kind: "clean", got: result.unexpected_median ?? 0, errored };
  return { kind: "defect", expected, matched: result.matched_median ?? 0, errored };
}

/** Only the outcomes that say something about the skill get a chip; error shows as the icon. */
export function showsOutcomeChip(outcome: EvalCaseOutcome): boolean {
  return CHIP_OUTCOMES.includes(outcome);
}

/** Medians can end in .5: one decimal at most, no trailing ".0". */
export function formatCount(n: number): string {
  return String(Math.round(n * 10) / 10);
}
