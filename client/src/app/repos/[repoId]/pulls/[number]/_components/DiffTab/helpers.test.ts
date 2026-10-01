import { describe, expect, it } from "vitest";
import { SmartDiffRole } from "@devdigest/shared/contracts/brief";
import type { FindingRecord, PrFile, ReviewRecord, SmartDiff } from "@devdigest/shared";
import {
  collapsedPathsFor,
  countFilesWithFindings,
  groupFilesByRole,
  selectDiffFindings,
  summarize,
  toggleLabel,
  unmatchedFileFindings,
} from "./helpers";

const file = (path: string, additions = 1, deletions = 0): PrFile => ({ path, additions, deletions, patch: null });

function finding(id: string, over: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id,
    severity: "WARNING",
    category: "bug",
    title: id,
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "r",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rv",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  } as FindingRecord;
}

function review(agent_id: string | null, created_at: string, findings: FindingRecord[]): ReviewRecord {
  return {
    id: `${agent_id}-${created_at}`,
    pr_id: "pr",
    agent_id,
    run_id: null,
    kind: "review",
    verdict: null,
    summary: null,
    score: null,
    model: null,
    created_at,
    findings,
  };
}

describe("selectDiffFindings (D5, mirror of the server rule)", () => {
  it("keeps only the latest review per agent, null being its own key, regardless of input order", () => {
    const out = selectDiffFindings([
      review(null, "2026-01-01T00:00:00Z", [finding("null-old")]),
      review("A", "2026-01-03T00:00:00Z", [finding("A-new")]),
      review("B", "2026-01-02T00:00:00Z", [finding("B")]),
      review("A", "2026-01-01T00:00:00Z", [finding("A-old")]),
      review(null, "2026-01-04T00:00:00Z", [finding("null-new")]),
    ]);
    expect(out.map((f) => f.id).sort()).toEqual(["A-new", "B", "null-new"]);
  });
});

describe("groupFilesByRole", () => {
  const smart: SmartDiff = {
    groups: [
      { role: "core", files: [{ path: "src/a.ts", additions: 1, deletions: 0, finding_lines: [] }] },
      { role: "tests", files: [{ path: "src/a.test.ts", additions: 1, deletions: 0, finding_lines: [] }] },
    ],
    split_suggestion: { too_big: false, total_lines: 2, proposed_splits: [] },
  };

  it("returns all five roles in contract order, empty ones kept", () => {
    const groups = groupFilesByRole([file("src/a.ts"), file("src/a.test.ts")], smart);
    expect(groups.map((g) => g.role)).toEqual(SmartDiffRole.options);
    expect(groups.map((g) => g.isEmpty)).toEqual([false, false, true, true, true]);
  });

  it("puts a path missing from the response in core and keeps pr.files order", () => {
    const groups = groupFilesByRole([file("z.ts"), file("src/a.test.ts"), file("src/a.ts")], smart);
    expect(groups[0]?.files.map((f) => f.path)).toEqual(["z.ts", "src/a.ts"]);
    expect(groups[1]?.files.map((f) => f.path)).toEqual(["src/a.test.ts"]);
  });
});

describe("counters", () => {
  const files = [file("src/a.ts"), file("src/b.ts"), file("src/c.ts")];

  it("counts files, not findings (2 files with 5 findings -> 2)", () => {
    const fs = [
      finding("1", { file: "src/a.ts" }),
      finding("2", { file: "src/a.ts" }),
      finding("3", { file: "src/a.ts" }),
      finding("4", { file: "src/b.ts" }),
      finding("5", { file: "src/b.ts" }),
    ];
    expect(countFilesWithFindings(files, fs)).toBe(2);
  });

  it("a file with only dismissed findings does not count", () => {
    expect(countFilesWithFindings(files, [finding("1", { dismissed_at: "2026-01-01" })])).toBe(0);
  });

  it("unmatchedFileFindings keeps findings on paths not in the PR", () => {
    const fs = [finding("1", { file: "src/a.ts" }), finding("2", { file: "old/name.ts" })];
    expect(unmatchedFileFindings(files, fs).map((f) => f.id)).toEqual(["2"]);
  });

  it("summarize sums additions and deletions", () => {
    expect(summarize([file("a", 3, 1), file("b", 2, 4)])).toEqual({ count: 2, additions: 5, deletions: 5 });
    expect(summarize([])).toEqual({ count: 0, additions: 0, deletions: 0 });
  });
});

describe("toggleLabel", () => {
  const none = { commentCount: 0, findingCount: 0, activeFindingCount: 0 };

  it("no findings: today's comment-only toggle", () => {
    expect(toggleLabel(null, { ...none, commentCount: 2 })).toMatchObject({ key: "showComments", count: 2, visible: true, next: true });
    expect(toggleLabel(true, { ...none, commentCount: 2 })).toMatchObject({ key: "hideComments", next: false });
    expect(toggleLabel(null, none).visible).toBe(false);
  });

  it("findings + comments: null -> showAll, click sets true; then hide; then show", () => {
    const c = { commentCount: 2, findingCount: 3, activeFindingCount: 2 };
    expect(toggleLabel(null, c)).toMatchObject({ key: "showAll", count: 4, next: true });
    expect(toggleLabel(true, c)).toMatchObject({ key: "hideCommentsAndFindings", next: false });
    expect(toggleLabel(false, c)).toMatchObject({ key: "showCommentsAndFindings", next: true });
  });

  it("PC-7: no comments, findings, untouched -> already showing everything, click hides", () => {
    const c = { commentCount: 0, findingCount: 4, activeFindingCount: 4 };
    expect(toggleLabel(null, c)).toMatchObject({ key: "hideCommentsAndFindings", count: 4, next: false });
    expect(toggleLabel(false, c)).toMatchObject({ key: "showCommentsAndFindings", next: true });
  });

  it("only dismissed findings still render the button, counted as 0", () => {
    const r = toggleLabel(null, { commentCount: 0, findingCount: 1, activeFindingCount: 0 });
    expect(r).toMatchObject({ visible: true, count: 0, key: "hideCommentsAndFindings" });
  });
});

describe("collapsedPathsFor", () => {
  const group = (role: SmartDiffRole, paths: string[]) => ({
    role,
    files: paths.map((p) => file(p)),
    isEmpty: paths.length === 0,
  });

  it("collects the paths of docs and boilerplate groups only", () => {
    const paths = collapsedPathsFor([
      group("core", ["a.ts"]),
      group("tests", ["a.test.ts"]),
      group("wiring", ["w.ts"]),
      group("docs", ["README.md", "docs/x.md"]),
      group("boilerplate", ["pnpm-lock.yaml"]),
    ]);
    expect([...paths].sort()).toEqual(["README.md", "docs/x.md", "pnpm-lock.yaml"]);
  });

  it("is empty when there are no groups or only expanded roles", () => {
    expect(collapsedPathsFor([]).size).toBe(0);
    expect(collapsedPathsFor([group("core", ["a.ts"]), group("docs", [])]).size).toBe(0);
  });
});
