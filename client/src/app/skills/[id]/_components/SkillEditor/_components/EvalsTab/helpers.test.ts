import { describe, it, expect } from "vitest";
import type { EvalCaseLatestResult, EvalSuite, EvalSuiteCaseResult, EvalSuiteDetail, SkillEvalCase } from "@devdigest/shared";
import {
  caseIconState,
  passingBadge,
  cardResults,
  runBlockedReason,
  runnableCaseCount,
  runningSuite,
  wholeSkillSuite,
} from "./helpers";

const suite = (id: string, status: EvalSuite["status"]) => ({ id, status }) as EvalSuite;

describe("runnableCaseCount / runBlockedReason", () => {
  const cases = [{ expectation: null }, { expectation: { must_find: [], must_not_find: [] } }] as unknown as SkillEvalCase[];

  it("counts only cases whose expectations parse", () => {
    expect(runnableCaseCount(cases)).toBe(1);
    expect(runnableCaseCount(undefined)).toBe(0);
  });

  it("blocks while a suite runs, then when nothing is runnable", () => {
    expect(runBlockedReason(3, suite("r", "running"))).toBe("runBlockedRunning");
    expect(runBlockedReason(0, suite("d", "done"))).toBe("runBlockedNoCases");
    expect(runBlockedReason(2, null)).toBeNull();
  });
});

const result = (over: Partial<EvalSuiteCaseResult> = {}): EvalSuiteCaseResult => ({
  case_id: "c1",
  case_name: "n",
  with: { passed: 3, total: 3 },
  without: { passed: 0, total: 3 },
  outcome: "caught",
  ...over,
});

describe("caseIconState (with-skill result)", () => {
  it("is never for a case without a result", () => {
    expect(caseIconState(null)).toBe("never");
  });
  it("pass when every with-repeat passed, fail otherwise", () => {
    expect(caseIconState(result())).toBe("pass");
    expect(caseIconState(result({ with: { passed: 0, total: 3 }, outcome: "fail_both" }))).toBe("fail");
    expect(caseIconState(result({ with: { passed: 0, total: 3 }, without: { passed: 3, total: 3 }, outcome: "regressed" }))).toBe("fail");
  });
  it("outcome error, flaky and pending win over the tally", () => {
    expect(caseIconState(result({ outcome: "error" }))).toBe("error");
    expect(caseIconState(result({ outcome: "flaky", with: { passed: 2, total: 3 } }))).toBe("flaky");
    expect(caseIconState(result({ outcome: "pending", with: { passed: 0, total: 0 } }))).toBe("pending");
  });
});


describe("per-case suites vs the whole-skill suite", () => {
  const partial = (id: string, status: EvalSuite["status"] = "done") => ({ id, status, partial: true, case_ids: ["c1"] }) as EvalSuite;
  const list = [suite("e", "estimated"), partial("p2"), partial("p1"), suite("w", "done"), suite("old", "done")];

  it("wholeSkillSuite skips estimates and partial suites", () => {
    expect(wholeSkillSuite(list)?.id).toBe("w");
    expect(wholeSkillSuite([partial("p")])).toBeNull();
    expect(wholeSkillSuite(undefined)).toBeNull();
  });

  it("runningSuite finds a running suite, partial or not", () => {
    expect(runningSuite([partial("p", "running"), suite("w", "done")])?.id).toBe("p");
    expect(runningSuite(list)).toBeNull();
  });

  it("cardResults: each case takes its own latest row; a live running suite overrides only its cases", () => {
    const row = (case_id: string, over: Partial<EvalCaseLatestResult> = {}): EvalCaseLatestResult => ({
      case_id, suite_id: `s-${case_id}`, suite_partial: true, suite_created_at: "2026-09-29T10:00:00.000Z", outcome: "caught",
      with: { passed: 1, total: 1 }, without: { passed: 0, total: 1 }, expected_count: 1, matched_median: 1, unexpected_median: 0,
      is_clean: false, with_errored: 0, stale: false, ...over,
    });
    const cases = [{ id: "c1", name: "one" }, { id: "c2", name: "two" }, { id: "c3", name: "three" }];
    const out = cardResults([row("c1"), row("c2", { outcome: "regressed" })], cases, undefined);
    expect(out.get("c1")).toMatchObject({ case_id: "c1", case_name: "one", outcome: "caught", matched_median: 1 });
    expect(out.get("c2")?.outcome).toBe("regressed");
    expect(out.has("c3")).toBe(false);

    const live = { cases: [result({ case_id: "c2", outcome: "pending", matched_median: null })] } as EvalSuiteDetail;
    const merged = cardResults([row("c1"), row("c2")], cases, live);
    expect(merged.get("c2")?.outcome).toBe("pending");
    expect(merged.get("c1")?.outcome).toBe("caught");
    expect(cardResults(undefined, cases, undefined).size).toBe(0);
  });
});

describe("passingBadge", () => {
  const r = (passing: number, total: number, errored = 0) => ({ passing, total, errored });

  it("0 / 0 with nothing errored: neutral, no ratio", () => {
    expect(passingBadge(r(0, 0))).toEqual({ tone: "neutral", label: "none", errored: 0 });
  });

  it("0 / 0 with errored cases: neutral and carries the errored count", () => {
    expect(passingBadge(r(0, 0, 2))).toEqual({ tone: "neutral", label: "none", errored: 2 });
  });

  it("colours by ratio once something settled: all passing ok, some failing warn, none passing crit", () => {
    expect(passingBadge(r(20, 20))).toMatchObject({ tone: "ok", label: "ratio" });
    expect(passingBadge(r(17, 20))).toMatchObject({ tone: "warn", label: "ratio" });
    expect(passingBadge(r(0, 4))).toMatchObject({ tone: "crit", label: "ratio" });
  });
});
