import { describe, it, expect } from "vitest";
import type { EvalCaseArmDetail, EvalCaseRunDetail } from "@devdigest/shared";
import { formatDuration, mustFindMark, unexpectedGroups } from "./helpers";

const run = (over: Partial<EvalCaseRunDetail> = {}): EvalCaseRunDetail => ({
  repeat_idx: 0,
  status: "done",
  pass: true,
  matched_must_find: [0],
  missed_must_find: [],
  unexpected: 0,
  unexpected_findings: [],
  duration_ms: 1000,
  cost_usd: 0.01,
  cost_source: "provider",
  error: null,
  ...over,
});

describe("mustFindMark", () => {
  it("matched when every done repeat matched the row", () => {
    expect(mustFindMark(0, [run(), run({ repeat_idx: 1 })])).toEqual({ kind: "matched" });
  });
  it("missed when no done repeat matched it", () => {
    expect(mustFindMark(0, [run({ matched_must_find: [], missed_must_find: [0] })])).toEqual({ kind: "missed" });
  });
  it("partial with the hit count when repeats disagree", () => {
    const runs = [run(), run({ repeat_idx: 1, matched_must_find: [], missed_must_find: [0] }), run({ repeat_idx: 2 })];
    expect(mustFindMark(0, runs)).toEqual({ kind: "partial", hit: 2, done: 3 });
  });
  it("none while nothing is scored (queued, running, failed)", () => {
    expect(mustFindMark(0, [run({ status: "running", matched_must_find: [] }), run({ status: "failed", pass: null })])).toEqual({ kind: "none" });
    expect(mustFindMark(0, [])).toEqual({ kind: "none" });
  });
});

describe("formatDuration", () => {
  it("is seconds with one decimal, a dash when unknown", () => {
    expect(formatDuration(1234)).toBe("1.2");
    expect(formatDuration(0)).toBe("0.0");
    expect(formatDuration(null)).toBeNull();
  });
});

describe("unexpectedGroups", () => {
  const finding = { file: "a.ts", line: 3, severity: "WARNING" as const, category: "bug" as const, title: "x" };
  const arm = (runs: EvalCaseRunDetail[]): EvalCaseArmDetail => ({ passed: 0, total: runs.length, matched_median: 0, unexpected_median: 0, runs });
  it("lists only repeats with findings, with how many were cut off", () => {
    const groups = unexpectedGroups({
      with: arm([run({ unexpected: 25, unexpected_findings: [finding] }), run({ repeat_idx: 1 })]),
      without: arm([run({ unexpected: 1, unexpected_findings: [finding] })]),
    });
    expect(groups.map((g) => [g.arm, g.repeat_idx, g.hidden])).toEqual([
      ["with", 0, 24],
      ["without", 0, 0],
    ]);
  });
});
