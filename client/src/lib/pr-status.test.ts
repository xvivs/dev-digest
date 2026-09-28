import { describe, it, expect } from "vitest";
import type { PrStatus } from "@devdigest/shared";
import { OPEN_STATUSES, isOpenStatus, countOpen, countNeedsReview } from "./pr-status";

const ALL: PrStatus[] = ["needs_review", "reviewed", "stale", "open", "closed", "merged"];
const pulls = (...s: PrStatus[]) => s.map((status) => ({ status }));

describe("pr-status", () => {
  it("treats needs_review / reviewed / stale as open", () => {
    expect(ALL.filter(isOpenStatus)).toEqual(["needs_review", "reviewed", "stale"]);
    expect([...OPEN_STATUSES]).toEqual(["needs_review", "reviewed", "stale"]);
  });

  it("counts open and needs-review PRs", () => {
    const list = pulls("needs_review", "needs_review", "reviewed", "stale", "merged", "closed");
    expect(countOpen(list)).toBe(4);
    expect(countNeedsReview(list)).toBe(2);
  });

  it("returns 0 for an absent or empty list", () => {
    expect(countOpen(undefined)).toBe(0);
    expect(countNeedsReview(undefined)).toBe(0);
    expect(countNeedsReview([])).toBe(0);
  });
});
