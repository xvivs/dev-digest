import { describe, it, expect } from "vitest";
import { formatSignedDelta, passRatePercent } from "./helpers";

describe("passRatePercent", () => {
  it("rounds to a whole percent", () => {
    expect(passRatePercent(17, 20)).toBe(85);
    expect(passRatePercent(2, 3)).toBe(67);
  });

  it("is 0 with no cases instead of NaN", () => {
    expect(passRatePercent(0, 0)).toBe(0);
  });
});

describe("formatSignedDelta", () => {
  it.each([
    [0.4, "+0.4"],
    [-1.25, "−1.2"],
    [0, "0.0"],
    [0.04, "0.0"],
    [-0.04, "0.0"],
  ])("%s → %s", (value, expected) => {
    expect(formatSignedDelta(value)).toBe(expected);
  });
});
