import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { clampToViewport, sortBySeverity, lineLabel } from "./helpers";

const VIEWPORT = { w: 1000, h: 800 };
const PANEL = { w: 360, h: 240 };
const GAP = 8;

function rect(o: Partial<DOMRect>): DOMRect {
  const base = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  return { ...base, ...o, toJSON: () => ({}) } as DOMRect;
}

describe("clampToViewport", () => {
  it("places the panel below the anchor when it fits, aligned to the anchor's left edge", () => {
    const r = clampToViewport({
      anchor: rect({ top: 100, bottom: 120, left: 200, right: 260 }),
      panel: PANEL,
      viewport: VIEWPORT,
      gap: GAP,
    });
    expect(r).toEqual({ top: 128, left: 200, placement: "bottom" });
  });

  it("flips above the anchor when the panel does not fit below and there is more room above", () => {
    const r = clampToViewport({
      anchor: rect({ top: 700, bottom: 720, left: 100, right: 160 }),
      panel: PANEL,
      viewport: VIEWPORT,
      gap: GAP,
    });
    expect(r.placement).toBe("top");
    // Sits entirely above the anchor, one gap clear of it.
    expect(r.top).toBe(700 - GAP - PANEL.h);
    expect(r.top + PANEL.h).toBeLessThanOrEqual(700);
  });

  it("keeps the panel on screen at the right edge instead of aligning to the anchor", () => {
    const r = clampToViewport({
      anchor: rect({ top: 100, bottom: 120, left: 960, right: 990 }),
      panel: PANEL,
      viewport: VIEWPORT,
      gap: GAP,
    });
    expect(r.left).toBe(VIEWPORT.w - PANEL.w - GAP);
    expect(r.left + PANEL.w).toBeLessThanOrEqual(VIEWPORT.w);
  });

  it("keeps the panel on screen at the bottom edge", () => {
    const r = clampToViewport({
      anchor: rect({ top: 780, bottom: 796, left: 10, right: 60 }),
      panel: PANEL,
      viewport: VIEWPORT,
      gap: GAP,
    });
    expect(r.top).toBeGreaterThanOrEqual(GAP);
    expect(r.top + PANEL.h).toBeLessThanOrEqual(VIEWPORT.h);
  });

  it("never pushes the panel off the top or left when the viewport is smaller than the panel", () => {
    const r = clampToViewport({
      anchor: rect({ top: 10, bottom: 26, left: 2, right: 40 }),
      panel: { w: 360, h: 240 },
      viewport: { w: 320, h: 200 },
      gap: GAP,
    });
    expect(r.top).toBe(GAP);
    expect(r.left).toBe(GAP);
  });
});

function finding(o: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f1",
    review_id: "r1",
    severity: "WARNING",
    category: "bug",
    title: "Title",
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "because",
    suggestion: null,
    confidence: 0.9,
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

describe("sortBySeverity", () => {
  it("orders CRITICAL → WARNING → SUGGESTION and keeps input order within a severity", () => {
    const out = sortBySeverity([
      finding({ id: "s1", severity: "SUGGESTION" }),
      finding({ id: "w1", severity: "WARNING" }),
      finding({ id: "c1", severity: "CRITICAL" }),
      finding({ id: "w2", severity: "WARNING" }),
    ]);
    expect(out.map((f) => f.id)).toEqual(["c1", "w1", "w2", "s1"]);
  });

  it("does not mutate its input", () => {
    const input = [finding({ id: "s1", severity: "SUGGESTION" }), finding({ id: "c1", severity: "CRITICAL" })];
    sortBySeverity(input);
    expect(input.map((f) => f.id)).toEqual(["s1", "c1"]);
  });
});

describe("lineLabel", () => {
  it("renders a single line as one number and a span as a range", () => {
    expect(lineLabel({ start_line: 12, end_line: 12 })).toBe("12");
    expect(lineLabel({ start_line: 12, end_line: 18 })).toBe("12-18");
  });
});
