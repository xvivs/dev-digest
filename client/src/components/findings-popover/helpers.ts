/**
 * Pure geometry + ordering for FindingsPopover. Kept out of the component so
 * the edge cases that matter (anchor pinned to the right/bottom edge) are
 * testable without a layout engine — jsdom has none.
 */
import type { FindingRecord } from "@devdigest/shared";
import { SEVERITY_RANK } from "@devdigest/ui";

/** Rank for a severity the design system does not know (the DB column is text): last. */
const UNKNOWN_RANK = Number.MAX_SAFE_INTEGER;

export type Placement = "top" | "bottom";

export interface PanelPosition {
  top: number;
  left: number;
  placement: Placement;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

/**
 * Place the panel next to its anchor without letting it leave the viewport.
 *
 * All coordinates are viewport-relative (`getBoundingClientRect` + `innerWidth`
 * /`innerHeight`), which is exactly what `position: fixed` consumes — so no
 * scroll offset is ever added. Below the anchor is preferred; it flips above
 * only when the panel does not fit below AND there is more room above.
 */
export function clampToViewport(a: {
  anchor: DOMRect;
  panel: { w: number; h: number };
  viewport: { w: number; h: number };
  gap: number;
}): PanelPosition {
  const { anchor, panel, viewport, gap } = a;

  const spaceBelow = viewport.h - anchor.bottom;
  const spaceAbove = anchor.top;
  const fitsBelow = spaceBelow >= panel.h + gap;
  const placement: Placement = fitsBelow || spaceBelow >= spaceAbove ? "bottom" : "top";

  const rawTop = placement === "bottom" ? anchor.bottom + gap : anchor.top - gap - panel.h;

  return {
    top: clamp(rawTop, gap, viewport.h - panel.h - gap),
    left: clamp(anchor.left, gap, viewport.w - panel.w - gap),
    placement,
  };
}

/**
 * Worst findings first, in the design system's `SEVERITY_ORDER`. `sort` is
 * stable in every engine we target, so findings of equal severity keep the
 * order the API returned them in. Not `compareSeverity`: that one has no
 * fallback for an out-of-union value and would return NaN.
 */
export function sortBySeverity(findings: readonly FindingRecord[]): FindingRecord[] {
  return [...findings].sort(
    (x, y) => (SEVERITY_RANK[x.severity] ?? UNKNOWN_RANK) - (SEVERITY_RANK[y.severity] ?? UNKNOWN_RANK),
  );
}

/** `12` for a single-line finding, `12–18` for a span. */
export function lineLabel(f: { start_line: number; end_line: number }): string {
  return f.start_line === f.end_line ? String(f.start_line) : `${f.start_line}-${f.end_line}`;
}
