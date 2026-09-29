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
  | { kind: "defect"; expected: number; matched: number }
  | { kind: "clean"; got: number };

/** Second line of the card, from the server's per-case summary (medians over the with-arm repeats). */
export function caseSubtitle(result: EvalSuiteCaseResult | null): CaseSubtitle {
  if (!result) return { kind: "never" };
  if (result.outcome === "error") return { kind: "error" };
  const expected = result.expected_count;
  if (expected == null) return { kind: "pending" };
  if (result.is_clean || expected === 0) return { kind: "clean", got: result.unexpected_median ?? 0 };
  return { kind: "defect", expected, matched: result.matched_median ?? 0 };
}

/** Only the outcomes that say something about the skill get a chip; error shows as the icon. */
export function showsOutcomeChip(outcome: EvalCaseOutcome): boolean {
  return CHIP_OUTCOMES.includes(outcome);
}

/** Medians can end in .5: one decimal at most, no trailing ".0". */
export function formatCount(n: number): string {
  return String(Math.round(n * 10) / 10);
}
