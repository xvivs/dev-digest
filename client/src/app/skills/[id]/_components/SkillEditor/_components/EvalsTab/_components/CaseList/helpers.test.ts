import { describe, it, expect } from "vitest";
import type { EvalExpectation, EvalSuiteCaseResult } from "@devdigest/shared";
import { caseSubtitle, caseTag, formatCount, showsOutcomeChip } from "./helpers";

const result = (over: Partial<EvalSuiteCaseResult> = {}): EvalSuiteCaseResult => ({
  case_id: "c1",
  case_name: "n",
  with: { passed: 3, total: 3 },
  without: { passed: 0, total: 3 },
  outcome: "caught",
  ...over,
});

const exp = (must_find: EvalExpectation["must_find"], must_not_find: EvalExpectation["must_not_find"] = []): EvalExpectation => ({
  must_find,
  must_not_find,
});
const finding = (min_severity: "CRITICAL" | "WARNING", category: "security" | "bug") => ({ file: "a.ts", min_severity, category });

describe("caseTag", () => {
  it("is severity · category of the first must_find", () => {
    expect(caseTag(exp([finding("CRITICAL", "security")]))).toEqual({ kind: "defect", severity: "CRITICAL", category: "security", more: 0 });
  });
  it("counts the other must_find rows as more", () => {
    expect(caseTag(exp([finding("WARNING", "bug"), finding("CRITICAL", "security"), finding("CRITICAL", "bug")]))).toMatchObject({
      severity: "WARNING",
      more: 2,
    });
  });
  it("is empty for a clean case and null for a legacy one", () => {
    expect(caseTag(exp([], [{ file: "a.ts" }]))).toEqual({ kind: "clean" });
    expect(caseTag(null)).toBeNull();
  });
});

describe("caseSubtitle", () => {
  it("never run without a result", () => {
    expect(caseSubtitle(null)).toEqual({ kind: "never" });
  });
  it("expected N, matched X (median) for a defect case", () => {
    expect(caseSubtitle(result({ expected_count: 2, matched_median: 1.5, is_clean: false }))).toEqual({ kind: "defect", expected: 2, matched: 1.5, errored: 0 });
  });
  it("expected 0, got U (median unexpected) for a clean case", () => {
    expect(caseSubtitle(result({ expected_count: 0, unexpected_median: 1, is_clean: true }))).toEqual({ kind: "clean", got: 1, errored: 0 });
  });
  it("in progress while the with arm has no scored repeat", () => {
    expect(caseSubtitle(result({ outcome: "pending", expected_count: null, matched_median: null }))).toEqual({ kind: "pending" });
  });
  it("errored with no scored with-arm run is 'run failed', never 'matched 0'", () => {
    expect(caseSubtitle(result({ outcome: "error", expected_count: 1, matched_median: null, with_errored: 1 }))).toEqual({ kind: "error" });
    expect(caseSubtitle(result({ outcome: "error", expected_count: 1, matched_median: null }))).toEqual({ kind: "error" });
    expect(caseSubtitle(result({ outcome: "error", expected_count: null }))).toEqual({ kind: "error" });
  });
  it("pending with nothing scored is 'running', even when the without arm gave an expected count", () => {
    expect(caseSubtitle(result({ outcome: "pending", expected_count: 1, matched_median: null }))).toEqual({ kind: "pending" });
  });
  it("some repeats scored, some errored: matched X plus the errored count", () => {
    expect(caseSubtitle(result({ outcome: "error", expected_count: 2, matched_median: 1, with_errored: 1 }))).toEqual({
      kind: "defect",
      expected: 2,
      matched: 1,
      errored: 1,
    });
    expect(caseSubtitle(result({ outcome: "error", expected_count: 0, unexpected_median: 2, is_clean: true, with_errored: 2 }))).toEqual({
      kind: "clean",
      got: 2,
      errored: 2,
    });
  });
  it("a clean case with nothing scored is not 'got 0'", () => {
    expect(caseSubtitle(result({ outcome: "error", expected_count: 0, unexpected_median: null, is_clean: true }))).toEqual({ kind: "error" });
  });
});

describe("showsOutcomeChip", () => {
  it("only caught, regressed and flaky", () => {
    expect(["caught", "regressed", "flaky", "pass_both", "fail_both", "pending", "error"].filter((o) => showsOutcomeChip(o as never))).toEqual([
      "caught",
      "regressed",
      "flaky",
    ]);
  });
});

describe("formatCount", () => {
  it("drops a trailing .0 and keeps one decimal", () => {
    expect(formatCount(2)).toBe("2");
    expect(formatCount(1.5)).toBe("1.5");
    expect(formatCount(0.3333)).toBe("0.3");
  });
});
