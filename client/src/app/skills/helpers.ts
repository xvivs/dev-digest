import { DEFAULT_EDITOR_TAB, SKILLS_HREF } from "./constants";

/** URL of a skill's editor, opened on `tab`. */
export function skillEditorHref(id: string, tab: string = DEFAULT_EDITOR_TAB): string {
  return `${SKILLS_HREF}/${encodeURIComponent(id)}?tab=${encodeURIComponent(tab)}`;
}

// ---- Skill-impact formatting, shared by the Stats and Evals tabs ----

/** `passing / total` as a whole percent for CircularScore; 0 when there are no cases. */
export function passRatePercent(passing: number, total: number): number {
  return total > 0 ? Math.round((passing / total) * 100) : 0;
}

/** Signed one-decimal delta: "+0.4", "−1.2" (U+2212), "0.0". */
export function formatSignedDelta(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const abs = Math.abs(rounded).toFixed(1);
  if (rounded > 0) return `+${abs}`;
  if (rounded < 0) return `−${abs}`;
  return abs;
}
