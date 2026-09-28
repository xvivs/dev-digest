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
 * zero-width characters (invisible smuggling) are rejected outright.
 */
export const INVISIBLE_CHARS_PATTERN =
  /[\u{E0000}-\u{E007F}\u{202A}-\u{202E}\u{2066}-\u{2069}\u{200B}-\u{200D}\u{FEFF}]/u;
