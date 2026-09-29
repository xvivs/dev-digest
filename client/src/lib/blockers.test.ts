import { describe, it, expect } from "vitest";
import type { Severity } from "@devdigest/shared";
import { countBlockers } from "./blockers";

const f = (...s: Severity[]) => s.map((severity) => ({ severity }));
const MIXED = f("CRITICAL", "CRITICAL", "WARNING");

describe("countBlockers (mirrors reviewer-core countBlockers)", () => {
  it("defaults to the critical gate", () => {
    expect(countBlockers(MIXED)).toBe(2);
  });

  it.each([
    ["never", 0],
    ["critical", 2],
    ["warning", 3],
    ["any", 3],
  ] as const)("failOn=%s → %i", (failOn, n) => {
    expect(countBlockers(MIXED, failOn)).toBe(n);
  });

  it("counts dismissed findings too, like the stored server value", () => {
    const dismissed = { severity: "CRITICAL" as const, dismissed_at: "2026-01-01T00:00:00Z" };
    expect(countBlockers([dismissed])).toBe(1);
  });

  it("is 0 for no findings", () => {
    expect(countBlockers([])).toBe(0);
  });
});
