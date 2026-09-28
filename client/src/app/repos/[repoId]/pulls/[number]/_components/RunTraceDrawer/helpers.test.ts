import { describe, expect, it } from "vitest";
import { formatApproxTokens, formatSeconds, formatTokens, isSkillDeleted } from "./helpers";

describe("formatSeconds", () => {
  it("formats milliseconds as seconds with one decimal", () => {
    expect(formatSeconds(1500)).toBe("1.5s");
  });
});

describe("formatTokens", () => {
  it("formats an in→out token summary in thousands", () => {
    expect(formatTokens(12000, 1500)).toBe("12k→1.5k");
  });
});

describe("formatApproxTokens", () => {
  it("shows a raw count under 1000", () => {
    expect(formatApproxTokens(500)).toBe("≈500 tokens");
  });

  it("shows a thousands-formatted count at or above 1000", () => {
    expect(formatApproxTokens(1500)).toBe("≈1.5k tokens");
  });
});

describe("isSkillDeleted", () => {
  it("returns false while knownSkillIds is null (still loading)", () => {
    expect(isSkillDeleted(null, "skill-1")).toBe(false);
  });

  it("returns false while knownSkillIds is undefined (still loading)", () => {
    expect(isSkillDeleted(undefined, "skill-1")).toBe(false);
  });

  it("returns false when the id is present in knownSkillIds", () => {
    expect(isSkillDeleted(new Set(["skill-1", "skill-2"]), "skill-1")).toBe(false);
  });

  it("returns true when the id is missing from knownSkillIds", () => {
    expect(isSkillDeleted(new Set(["skill-2"]), "skill-1")).toBe(true);
  });
});
