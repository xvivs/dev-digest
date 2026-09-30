import { describe, it, expect } from "vitest";
import { candidate } from "./fixtures";
import {
  acceptedIds,
  confidenceTone,
  effectiveSelection,
  filterByTab,
  isRuleValid,
  knownErrorCode,
  tabCounts,
} from "./helpers";

const mixed = [
  candidate("p", { status: "pending" }),
  candidate("a1", { status: "accepted" }),
  candidate("a2", { status: "accepted" }),
  candidate("r", { status: "rejected" }),
];

describe("filterByTab / tabCounts", () => {
  it("All is pending + accepted, Accepted and Rejected are exact", () => {
    expect(filterByTab(mixed, "all").map((c) => c.id)).toEqual(["p", "a1", "a2"]);
    expect(filterByTab(mixed, "accepted").map((c) => c.id)).toEqual(["a1", "a2"]);
    expect(filterByTab(mixed, "rejected").map((c) => c.id)).toEqual(["r"]);
  });

  it("tallies the counts from the same array the tabs filter", () => {
    expect(tabCounts(mixed)).toEqual({ all: 3, accepted: 2, rejected: 1 });
    expect(tabCounts([])).toEqual({ all: 0, accepted: 0, rejected: 0 });
  });
});

describe("confidenceTone", () => {
  it.each([
    [1, "high"],
    [0.8, "high"],
    [0.79, "medium"],
    [0.6, "medium"],
    [0.59, "low"],
    [0, "low"],
  ] as const)("%s is %s", (confidence, tone) => {
    expect(confidenceTone(confidence)).toBe(tone);
  });

  it("judges the rounded percentage, so a displayed 80% is never amber", () => {
    expect(confidenceTone(0.796)).toBe("high");
    expect(confidenceTone(0.594)).toBe("low");
  });
});

describe("selection", () => {
  it("lists accepted ids in list order", () => {
    expect(acceptedIds(mixed)).toEqual(["a1", "a2"]);
  });

  it("intersects the stored selection with what is accepted now", () => {
    const stored = new Set(["a1", "r", "gone"]);
    expect(effectiveSelection(stored, acceptedIds(mixed))).toEqual(["a1"]);
  });
});

describe("isRuleValid", () => {
  it("accepts 8..300 characters after trimming", () => {
    expect(isRuleValid("1234567")).toBe(false);
    expect(isRuleValid("  12345678  ")).toBe(true);
    expect(isRuleValid("x".repeat(300))).toBe(true);
    expect(isRuleValid("x".repeat(301))).toBe(false);
  });
});

describe("knownErrorCode", () => {
  it("reads the code before the colon", () => {
    expect(knownErrorCode("scan_deadline_exceeded: scan ran past 120s")).toBe("scan_deadline_exceeded");
    expect(knownErrorCode("empty_sample: no readable code files in the sample")).toBe("empty_sample");
  });

  it("accepts a bare code", () => {
    expect(knownErrorCode("head_moved")).toBe("head_moved");
  });

  it("returns null for unknown, empty and missing errors", () => {
    expect(knownErrorCode("boom: something")).toBeNull();
    expect(knownErrorCode("")).toBeNull();
    expect(knownErrorCode(null)).toBeNull();
  });
});
