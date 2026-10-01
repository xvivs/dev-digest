import { describe, expect, it } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { parsePatch } from "./helpers";
import { findingKey, findingsForFile, isActiveFinding, lineMarks } from "./findings";

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "bug",
    title: `t-${o.id}`,
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
    ...o,
  } as FindingRecord;
}

// new lines: ctx 1, add 2, add 3, (del), ctx 4
const LINES = parsePatch("@@ -1,3 +1,4 @@\n one\n+two\n+three\n-gone\n four");

describe("lineMarks", () => {
  it("stripes every rendered RIGHT line in the range and never a del row", () => {
    const marks = lineMarks(LINES, [finding({ id: "a", start_line: 2, end_line: 4 })]);
    expect([...marks.keys()].sort()).toEqual(["RIGHT:2", "RIGHT:3", "RIGHT:4"]);
  });

  it("marks isStart only on start_line", () => {
    const marks = lineMarks(LINES, [finding({ id: "a", start_line: 2, end_line: 3 })]);
    expect(marks.get("RIGHT:2")?.isStart).toBe(true);
    expect(marks.get("RIGHT:3")?.isStart).toBe(false);
  });

  it("takes the worst severity and its title on overlap", () => {
    const marks = lineMarks(LINES, [
      finding({ id: "w", severity: "WARNING", start_line: 2, end_line: 3 }),
      finding({ id: "c", severity: "CRITICAL", start_line: 3, end_line: 3 }),
    ]);
    expect(marks.get("RIGHT:2")).toMatchObject({ severity: "WARNING", title: "t-w" });
    expect(marks.get("RIGHT:3")).toMatchObject({ severity: "CRITICAL", title: "t-c", isStart: true });
  });

  it("treats end_line < start_line as a single line", () => {
    const marks = lineMarks(LINES, [finding({ id: "a", start_line: 3, end_line: 1 })]);
    expect([...marks.keys()]).toEqual(["RIGHT:3"]);
  });

  it("ignores dismissed findings", () => {
    const marks = lineMarks(LINES, [finding({ id: "a", start_line: 2, dismissed_at: "2026-01-01" })]);
    expect(marks.size).toBe(0);
  });
});

describe("finding helpers", () => {
  it("findingsForFile matches the exact path only", () => {
    const fs = [finding({ id: "a", file: "src/a.ts" }), finding({ id: "b", file: "src/A.ts" })];
    expect(findingsForFile(fs, "src/a.ts").map((f) => f.id)).toEqual(["a"]);
  });

  it("isActiveFinding: accepted counts, dismissed does not", () => {
    expect(isActiveFinding(finding({ id: "a", accepted_at: "2026-01-01" }))).toBe(true);
    expect(isActiveFinding(finding({ id: "a", dismissed_at: "2026-01-01" }))).toBe(false);
  });

  it("findingKey is RIGHT:<start_line>", () => {
    expect(findingKey(finding({ id: "a", start_line: 7 }))).toBe("RIGHT:7");
  });
});
