import { describe, it, expect } from "vitest";
import type { EvalSuite, SkillEvalCase } from "@devdigest/shared";
import { latestStartedSuite, runBlockedReason, runnableCaseCount } from "./helpers";

const suite = (id: string, status: EvalSuite["status"]) => ({ id, status }) as EvalSuite;

describe("latestStartedSuite", () => {
  it("skips estimate-only suites and takes the newest started one", () => {
    expect(latestStartedSuite([suite("e", "estimated"), suite("r", "running"), suite("d", "done")])?.id).toBe("r");
  });

  it("is null with no suites or only estimates", () => {
    expect(latestStartedSuite(undefined)).toBeNull();
    expect(latestStartedSuite([suite("e", "estimated")])).toBeNull();
  });
});

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
