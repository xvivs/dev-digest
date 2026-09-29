import { describe, it, expect } from "vitest";
import type { EvalSuite, EvalSuiteCaseResult, EvalSuiteDetail, SkillEvalCase } from "@devdigest/shared";
import {
  caseIconState,
  mergeCaseResults,
  newerPartialSuite,
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

  it("newerPartialSuite is the newest started partial suite that is newer than the whole one", () => {
    expect(newerPartialSuite(list)?.id).toBe("p2");
    expect(newerPartialSuite([suite("w", "done"), partial("p")])).toBeNull();
    expect(newerPartialSuite([partial("p")])?.id).toBe("p");
  });

  it("runningSuite finds a running suite, partial or not", () => {
    expect(runningSuite([partial("p", "running"), suite("w", "done")])?.id).toBe("p");
    expect(runningSuite(list)).toBeNull();
  });

  it("mergeCaseResults lets the newer per-case suite override that case only", () => {
    const full = { cases: [result({ case_id: "c1", outcome: "fail_both" }), result({ case_id: "c2" })] } as EvalSuiteDetail;
    const one = { cases: [result({ case_id: "c1", outcome: "caught" })] } as EvalSuiteDetail;
    const merged = mergeCaseResults(full, one);
    expect(merged.get("c1")?.outcome).toBe("caught");
    expect(merged.get("c2")?.outcome).toBe("caught");
    expect(mergeCaseResults(null, null).size).toBe(0);
  });
});
