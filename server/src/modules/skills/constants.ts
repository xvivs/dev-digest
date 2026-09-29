/** Constants for the skills module (SPEC-02). */

// Name/description/body limits live in `_shared/skill-rules.ts`.

/** Default skill description when none is supplied on insert (skills.description is NOT NULL). */
export const DEFAULT_SKILL_DESCRIPTION = '';

// Invisible-char hygiene lives in `_shared/text-hygiene.ts`; re-exported for existing importers.
export { INVISIBLE_CHARS_PATTERN } from '../_shared/text-hygiene.js';
