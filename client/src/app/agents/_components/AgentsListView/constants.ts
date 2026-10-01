/** Constants for the Agents list view. */

/** Quick-start agent templates surfaced in the "Add Agent" dropdown. */
export const TEMPLATES = ["Security", "Performance", "Mentor", "Conformance", "Architecture"] as const;

/** Card grid template (responsive auto-fill). */
export const CARD_GRID_COLS = "repeat(auto-fill, minmax(min(280px, 100%), 1fr))";

/** "Add Agent" dropdown width (px). */
export const ADD_MENU_WIDTH = 220;

/** Search glyph size (px). */
export const SEARCH_ICON_SIZE = 13;

/** Loading placeholders: how many cards, and each card's height (px). */
export const SKELETON_CARD_COUNT = 3;
export const SKELETON_CARD_HEIGHT = 120;
