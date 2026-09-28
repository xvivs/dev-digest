import { describe, it, expect } from "vitest";
import type { SkillVersionSummary } from "@devdigest/shared";
import { buildVersionRows } from "./helpers";

const v = (version: number): SkillVersionSummary => ({
  skill_id: "sk1",
  version,
  name: "gate",
  description: "d",
  type: "rubric",
  change_note: null,
  created_at: "2026-09-29T10:00:00.000Z",
});

describe("buildVersionRows", () => {
  it("lists newest first and marks the current version", () => {
    const rows = buildVersionRows([v(1), v(3), v(2)], 3);
    expect(rows.map((r) => [r.version, r.kind, r.kind === "snapshot" && r.isCurrent])).toEqual([
      [3, "snapshot", true],
      [2, "snapshot", false],
      [1, "snapshot", false],
    ]);
  });

  it("fills a version with no snapshot row as a gap (lost history, ADR 0016)", () => {
    const rows = buildVersionRows([v(4), v(2)], 4);
    expect(rows.map((r) => [r.version, r.kind])).toEqual([
      [4, "snapshot"],
      [3, "gap"],
      [2, "snapshot"],
      [1, "gap"],
    ]);
  });

  it("shows the current version as a gap when even it has no snapshot", () => {
    expect(buildVersionRows([], 2).map((r) => [r.version, r.kind])).toEqual([
      [2, "gap"],
      [1, "gap"],
    ]);
  });

  it("tells each snapshot whether the version before it has a snapshot", () => {
    const rows = buildVersionRows([v(3), v(1)], 3);
    const hasPrev = rows.filter((r) => r.kind === "snapshot").map((r) => [r.version, r.kind === "snapshot" && r.hasPrevSnapshot]);
    expect(hasPrev).toEqual([
      [3, false],
      [1, false],
    ]);
    expect(buildVersionRows([v(2), v(1)], 2)[0]).toMatchObject({ version: 2, hasPrevSnapshot: true });
  });
});
