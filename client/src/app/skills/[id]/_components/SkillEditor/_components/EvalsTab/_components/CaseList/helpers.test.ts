import { describe, it, expect } from "vitest";
import type { EvalSuiteRun } from "@devdigest/shared";
import { caseUnexpectedDelta } from "./helpers";

const run = (case_id: string, arm: EvalSuiteRun["arm"], unexpected: number | null, status: EvalSuiteRun["status"] = "done") =>
  ({ case_id, arm, unexpected, status }) as EvalSuiteRun;

describe("caseUnexpectedDelta", () => {
  it("is the mean unexpected with the skill minus without it, for this case only", () => {
    const runs = [run("c1", "with", 3), run("c1", "with", 1), run("c1", "without", 0), run("c2", "with", 9)];
    expect(caseUnexpectedDelta(runs, "c1")).toBe(2);
  });

  it("ignores unfinished runs and is null until both arms are scored", () => {
    expect(caseUnexpectedDelta([run("c1", "with", 2), run("c1", "without", 5, "running")], "c1")).toBeNull();
    expect(caseUnexpectedDelta([], "c1")).toBeNull();
  });
});
