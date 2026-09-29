import { describe, it, expect } from "vitest";
import { formatDuration, formatTokenCount } from "./helpers";

describe("formatDuration", () => {
  it("formats milliseconds, seconds and minutes", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(850)).toBe("850ms");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(72_400)).toBe("1m 12s");
    expect(formatDuration(120_000)).toBe("2m 0s");
  });
});

describe("formatTokenCount", () => {
  it("compacts thousands and millions", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(950)).toBe("950");
    expect(formatTokenCount(12_300)).toBe("12.3k");
    expect(formatTokenCount(12_000)).toBe("12k");
    expect(formatTokenCount(1_250_000)).toBe("1.3M");
  });
});
