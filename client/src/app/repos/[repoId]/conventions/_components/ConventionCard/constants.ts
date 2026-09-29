import type { ConfidenceTone } from "../../constants";

/** Confidence bar and card accent per tone (D16). */
export const TONE_COLOR: Record<ConfidenceTone, string> = {
  high: "var(--ok)",
  medium: "var(--warn)",
  low: "var(--crit)",
};
