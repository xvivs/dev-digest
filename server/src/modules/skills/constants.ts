/** Constants for the skills module (SPEC-02). */

/** Skill name grammar: a lowercase slug, 2-64 chars. */
export const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

export const SKILL_DESCRIPTION_MAX = 500;
/** Body: 1..32768 chars (spec `body 1..32768 chars`). */
export const SKILL_BODY_MAX = 32768;

/** Default skill description when none is supplied on insert (skills.description is NOT NULL). */
export const DEFAULT_SKILL_DESCRIPTION = '';

/**
 * ADR 0012 input hygiene: Unicode tag characters (used for tag-based prompt
 * injection), bidi overrides (visually reorder text to hide intent), and
 * zero-width characters, word joiners, direction marks and soft hyphens
 * (invisible smuggling) are rejected outright. Mirrored in
 * client/src/app/skills/helpers.ts (INVISIBLE_CHAR_SOURCE) — keep in sync.
 */
export const INVISIBLE_CHARS_PATTERN =
  /[\u{E0000}-\u{E007F}\u{202A}-\u{202E}\u{2066}-\u{2069}\u{200B}-\u{200F}\u{2060}-\u{2064}\u{061C}\u{180E}\u{00AD}\u{FEFF}]/u;

/** Stats tab windows (plan decision #11); the card always shows 30d. */
export const STATS_WINDOW_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;
/** `GET /skills` → `runs_30d`. */
export const LIST_RUNS_WINDOW_DAYS = 30;
