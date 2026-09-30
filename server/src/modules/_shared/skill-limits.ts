/**
 * Skill field limits shared by `skills` (HTTP create/update, restore) and
 * `conventions` (extracted skills). Pure constants, so a `domain.ts` can use
 * them without pulling in the zod schemas of `skill-rules.ts`.
 */

/** Skill name grammar: a lowercase slug, 2-64 chars. */
export const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const SKILL_DESCRIPTION_MAX = 500;
/** Body: 1..32768 chars (spec `body 1..32768 chars`). */
export const SKILL_BODY_MAX = 32768;
