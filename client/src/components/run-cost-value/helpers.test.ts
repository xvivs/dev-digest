import { describe, it, expect } from "vitest";
import { formatCost, exactCost } from "./helpers";

describe("formatCost", () => {
  it("uses 4 decimals below $0.01", () => {
    expect(formatCost(0.0013)).toBe("$0.0013");
    expect(formatCost(0.0099)).toBe("$0.0099");
  });

  it("uses 3 decimals from $0.01 up to (not including) $1", () => {
    expect(formatCost(0.01)).toBe("$0.010");
    expect(formatCost(0.014)).toBe("$0.014");
    expect(formatCost(0.999)).toBe("$0.999");
  });

  it("uses 2 decimals at $1 and above", () => {
    expect(formatCost(1)).toBe("$1.00");
    expect(formatCost(1.238)).toBe("$1.24");
  });

  it("renders zero as $0.0000, not a dash — a free run is a known cost, not a missing one", () => {
    expect(formatCost(0)).toBe("$0.0000");
  });
});

describe("exactCost", () => {
  it("never rounds, even where formatCost would", () => {
    expect(exactCost(1.238)).toBe("$1.238");
    expect(exactCost(0.0013)).toBe("$0.0013");
  });

  it("stays decimal below 1e-6, where Number.toString would go exponential", () => {
    expect(exactCost(0.0000001)).toBe("$0.0000001");
    expect(exactCost(0.00000012345)).toBe("$0.00000012345");
  });
});
