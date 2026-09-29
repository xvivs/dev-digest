import { describe, it, expect } from "vitest";
import { countBySeverity, presentSeverities, ZERO_COUNTS } from "./helpers";

describe("countBySeverity", () => {
  it("tallies the known severities into their lowercase wire keys", () => {
    expect(
      countBySeverity([
        { severity: "CRITICAL" },
        { severity: "WARNING" },
        { severity: "WARNING" },
      ]),
    ).toEqual({ critical: 1, warning: 2, suggestion: 0 });
  });

  it("returns an all-zero tally for an empty list", () => {
    expect(countBySeverity([])).toEqual(ZERO_COUNTS);
  });

  it("drops an unknown severity instead of bucketing it — the DB column is text, not an enum", () => {
    expect(
      countBySeverity([
        { severity: "CRITICAL" },
        { severity: "INFO" },
        { severity: "critical" },
        { severity: "" },
        { severity: "NOPE" },
      ]),
    ).toEqual({ critical: 1, warning: 0, suggestion: 0 });
  });

  it("ignores inherited Object keys, which a plain `in` check would have counted", () => {
    expect(countBySeverity([{ severity: "toString" }, { severity: "constructor" }])).toEqual(
      ZERO_COUNTS,
    );
  });

  it("never mutates ZERO_COUNTS", () => {
    countBySeverity([{ severity: "CRITICAL" }]);
    expect(ZERO_COUNTS).toEqual({ critical: 0, warning: 0, suggestion: 0 });
  });
});

describe("presentSeverities", () => {
  it("keeps only non-zero severities, worst first", () => {
    expect(presentSeverities({ critical: 0, warning: 3, suggestion: 0 })).toEqual(["WARNING"]);
  });

  it("returns every severity in CRITICAL → WARNING order", () => {
    expect(presentSeverities({ critical: 1, warning: 1, suggestion: 0 })).toEqual([
      "CRITICAL",
      "WARNING",
    ]);
  });

  it("returns an empty list for an all-zero tally", () => {
    expect(presentSeverities(ZERO_COUNTS)).toEqual([]);
  });
});
