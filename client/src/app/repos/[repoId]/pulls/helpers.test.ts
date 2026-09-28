import { describe, it, expect } from "vitest";
import { isSortOrder, relativeTime, sizeOf } from "./helpers";
import { SIZE_MEDIUM_MAX, SIZE_SMALL_MAX } from "./constants";

describe("sizeOf", () => {
  it("sums additions and deletions into the line count", () => {
    expect(sizeOf({ additions: 30, deletions: 12 })).toEqual({ size: "S", lines: 42 });
  });

  it("puts each threshold into the NEXT bucket (upper bounds are exclusive)", () => {
    expect(sizeOf({ additions: SIZE_SMALL_MAX - 1, deletions: 0 }).size).toBe("S");
    expect(sizeOf({ additions: SIZE_SMALL_MAX, deletions: 0 }).size).toBe("M");
    expect(sizeOf({ additions: SIZE_MEDIUM_MAX - 1, deletions: 0 }).size).toBe("M");
    expect(sizeOf({ additions: SIZE_MEDIUM_MAX, deletions: 0 }).size).toBe("L");
  });

  it("treats an empty PR as small", () => {
    expect(sizeOf({ additions: 0, deletions: 0 })).toEqual({ size: "S", lines: 0 });
  });
});

describe("relativeTime", () => {
  const NOW = Date.parse("2026-06-10T12:00:00.000Z");
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  const MIN = 60_000;

  it("returns null for a missing or unparseable date, so the view shows its dash", () => {
    expect(relativeTime(null, NOW)).toBeNull();
    expect(relativeTime(undefined, NOW)).toBeNull();
    expect(relativeTime("", NOW)).toBeNull();
    expect(relativeTime("not a date", NOW)).toBeNull();
  });

  it("returns `now` under half a minute, and for a timestamp in the future (clock skew)", () => {
    expect(relativeTime(ago(20_000), NOW)).toEqual({ unit: "now", value: 0 });
    expect(relativeTime(ago(-5 * MIN), NOW)).toEqual({ unit: "now", value: 0 });
  });

  it("counts minutes below an hour, hours below a day, days beyond", () => {
    expect(relativeTime(ago(5 * MIN), NOW)).toEqual({ unit: "minute", value: 5 });
    expect(relativeTime(ago(59 * MIN), NOW)).toEqual({ unit: "minute", value: 59 });
    expect(relativeTime(ago(60 * MIN), NOW)).toEqual({ unit: "hour", value: 1 });
    expect(relativeTime(ago(3 * 60 * MIN), NOW)).toEqual({ unit: "hour", value: 3 });
    expect(relativeTime(ago(24 * 60 * MIN), NOW)).toEqual({ unit: "day", value: 1 });
    expect(relativeTime(ago(10 * 24 * 60 * MIN), NOW)).toEqual({ unit: "day", value: 10 });
  });

  it("rounds rather than truncates (23.6h reads as 24h, not a day)", () => {
    expect(relativeTime(ago(23.6 * 60 * MIN), NOW)).toEqual({ unit: "day", value: 1 });
    expect(relativeTime(ago(23.4 * 60 * MIN), NOW)).toEqual({ unit: "hour", value: 23 });
  });

  it("defaults `now` to the current clock", () => {
    expect(relativeTime(new Date().toISOString())).toEqual({ unit: "now", value: 0 });
  });
});

describe("isSortOrder", () => {
  it("accepts the offered sort orders only", () => {
    expect(isSortOrder("newest")).toBe(true);
    expect(isSortOrder("oldest")).toBe(true);
    expect(isSortOrder("score")).toBe(false);
    expect(isSortOrder("")).toBe(false);
  });
});
