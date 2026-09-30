import { describe, it, expect } from "vitest";
import { compareAvailability, defaultCompareMode, diffBodies, diffStats, metadataChanges } from "./helpers";

describe("diffBodies", () => {
  it("numbers context, removed and added lines on their own side", () => {
    expect(diffBodies("a\nb\nc\n", "a\nB\nc\nd\n")).toEqual([
      { kind: "ctx", text: "a", oldNo: 1, newNo: 1 },
      { kind: "del", text: "b", oldNo: 2, newNo: null },
      { kind: "add", text: "B", oldNo: null, newNo: 2 },
      { kind: "ctx", text: "c", oldNo: 3, newNo: 3 },
      { kind: "add", text: "d", oldNo: null, newNo: 4 },
    ]);
  });

  it("handles a body without a trailing newline", () => {
    expect(diffBodies("x", "x\ny")).toEqual([
      { kind: "del", text: "x", oldNo: 1, newNo: null },
      { kind: "add", text: "x", oldNo: null, newNo: 1 },
      { kind: "add", text: "y", oldNo: null, newNo: 2 },
    ]);
  });

  it("keeps a blank line as a line", () => {
    expect(diffBodies("a\n\nb", "a\n\nb")).toEqual([
      { kind: "ctx", text: "a", oldNo: 1, newNo: 1 },
      { kind: "ctx", text: "", oldNo: 2, newNo: 2 },
      { kind: "ctx", text: "b", oldNo: 3, newNo: 3 },
    ]);
  });

  it("returns nothing for two empty bodies", () => {
    expect(diffBodies("", "")).toEqual([]);
  });
});

describe("diffStats", () => {
  it("counts added and removed lines", () => {
    expect(diffStats(diffBodies("a\nb\n", "a\nc\nd\n"))).toEqual({ added: 2, removed: 1 });
  });
});

describe("metadataChanges", () => {
  const base = { name: "gate", description: "old", type: "rubric" as const };

  it("lists only the fields that changed, in a fixed order", () => {
    expect(metadataChanges(base, { name: "gate-2", description: "old", type: "security" })).toEqual([
      { field: "name", from: "gate", to: "gate-2" },
      { field: "type", from: "rubric", to: "security" },
    ]);
  });

  it("skips a field a legacy snapshot never captured (null on either side)", () => {
    expect(metadataChanges({ name: null, description: null, type: null }, { name: "x", description: "y", type: "custom" })).toEqual([]);
  });

  it("is empty when nothing changed", () => {
    expect(metadataChanges(base, base)).toEqual([]);
  });
});

describe("compareAvailability", () => {
  it("v1 has no previous version to compare with", () => {
    expect(compareAvailability(1, 3, false)).toEqual({ prev: false, current: true });
  });

  it("the current version cannot be compared with itself", () => {
    expect(compareAvailability(3, 3, true)).toEqual({ prev: true, current: false });
  });

  it("a gap before this version disables vs prev", () => {
    expect(compareAvailability(4, 6, false)).toEqual({ prev: false, current: true });
  });
});

describe("defaultCompareMode", () => {
  it("prefers vs prev, falls back to vs current, and is null when neither works", () => {
    expect(defaultCompareMode({ prev: true, current: true })).toBe("prev");
    expect(defaultCompareMode({ prev: false, current: true })).toBe("current");
    expect(defaultCompareMode({ prev: false, current: false })).toBeNull();
  });
});
