import type { Severity } from "@devdigest/shared";

/**
 * Hover-intent delay before the panel opens, in ms. Also the window in which
 * `onArm` fires — a cursor sweeping down a list of PR rows must not fire one
 * request per row it crosses.
 */
export const OPEN_DELAY = 120;

/**
 * Grace period before the panel closes, in ms. Long enough for the cursor to
 * travel from the anchor onto the panel across the `PANEL_GAP` bridge.
 */
export const CLOSE_DELAY = 200;

/** How many findings the panel previews before collapsing the rest into "+N more". */
export const PREVIEW_LIMIT = 3;

/** Visual gap between anchor and panel, in px. Doubles as the invisible mouse bridge. */
export const PANEL_GAP = 8;

/** Panel width, in px. Fixed so the measured height is stable across a reflow. */
export const PANEL_WIDTH = 360;

/** Above `Dropdown`'s z-index 40, so a popover opened from a dropdown row wins. */
export const PANEL_Z = 60;

/** Sort weight — CRITICAL first. Local on purpose: the popover owns its own ordering. */
export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};
