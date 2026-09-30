/** Constants for the Skill Editor screen. */

/** Header glyph size (px). */
export const HEADER_ICON_SIZE = 18;

/** Loading placeholder sizes (px). */
export const SKELETON_TITLE = { height: 24, width: 240 } as const;
export const SKELETON_BODY_HEIGHT = 200;

/** Width (px) of the "Discard changes?" confirm modal. */
export const DIRTY_GUARD_MODAL_WIDTH = 440;

/** `?window=7d|30d|90d`: the Stats tab's time window (skill-impact decision 11). */
export const STATS_WINDOW_PARAM = "window";

/** `?case=<id>[&suite=<id>]`: the Evals tab's case drawer (linkable; Back closes it). */
export const CASE_PARAM = "case";
export const SUITE_PARAM = "suite";
