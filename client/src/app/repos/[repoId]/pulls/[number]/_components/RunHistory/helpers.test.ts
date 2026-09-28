import { describe, it, expect } from "vitest";
import type { PrCommit, RunSummary } from "@devdigest/shared";
import { buildTimeline, outcomeOf, tsOf } from "./helpers";

describe("outcomeOf", () => {
  it.each([
    [{ status: "running", blockers: 3, findings_count: 3 }, "running"],
    [{ status: "failed", blockers: null, findings_count: null }, "error"],
    [{ status: "cancelled", blockers: null, findings_count: null }, "cancelled"],
    [{ status: "done", blockers: 2, findings_count: 5 }, "rejected"],
    [{ status: "done", blockers: 0, findings_count: 5 }, "reviewed"],
    [{ status: "done", blockers: null, findings_count: 0 }, "approved"],
  ] as const)("%o → %s", (run, expected) => {
    expect(outcomeOf(run as Pick<RunSummary, "status" | "blockers" | "findings_count">)).toBe(expected);
  });
});

describe("tsOf / buildTimeline", () => {
  it("treats missing or unparseable timestamps as 0 so they sort last", () => {
    expect(tsOf(null)).toBe(0);
    expect(tsOf("nope")).toBe(0);
    expect(tsOf("2026-01-01T00:00:00.000Z")).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
  });

  it("interleaves runs and commits newest first", () => {
    const runs = [
      { run_id: "old", ran_at: "2026-01-01T00:00:00.000Z" },
      { run_id: "new", ran_at: "2026-01-03T00:00:00.000Z" },
    ] as RunSummary[];
    const commits = [{ sha: "c1", committed_at: "2026-01-02T00:00:00.000Z" }] as PrCommit[];
    const order = buildTimeline(runs, commits).map((i) => (i.kind === "run" ? i.run.run_id : i.commit.sha));
    expect(order).toEqual(["new", "c1", "old"]);
  });
});
