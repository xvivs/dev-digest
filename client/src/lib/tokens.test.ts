import { describe, it, expect } from "vitest";
import { estimateTokens } from "./tokens";

describe("estimateTokens", () => {
  it("rounds up chars / 4 (SPEC-02 D4)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });
});
