/** Constants for the Run Trace + Live Log drawer (A5). */

/** Drawer width (px). */
export const DRAWER_WIDTH = 720;

/** Live-log stream viewport height (px). */
export const LOG_HEIGHT = 420;

/** Tab keys (Trace / Live log). Labels come from `runs.drawer.tab.*`. */
export const TABS = ["trace", "log"] as const;
export type TraceTab = (typeof TABS)[number];

/** How long the footer's "Copied!" confirmation stays up (ms). */
export const RAW_COPIED_FEEDBACK_MS = 1500;

/** How long a prompt block's copy icon shows the check mark (ms). */
export const PROMPT_COPIED_FEEDBACK_MS = 1200;

/** Width of the fullscreen prompt modal (px). */
export const PROMPT_MODAL_WIDTH = 1200;

/** Prompt-assembly block accent colours (by leg). */
export const PROMPT_COLORS = {
  system: "var(--text-muted)",
  skills: "var(--accent)",
  memory: "var(--warn)",
  repoMap: "var(--accent)",
  specs: "var(--text-secondary)",
  callers: "var(--warn)",
  user: "var(--ok)",
} as const;
