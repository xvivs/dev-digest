/** Constants for the skills module (SPEC-02). */

// Name/description/body limits live in `_shared/skill-rules.ts`.

/** Default skill description when none is supplied on insert (skills.description is NOT NULL). */
export const DEFAULT_SKILL_DESCRIPTION = '';

// Invisible-char hygiene lives in `_shared/text-hygiene.ts`; re-exported for existing importers.
export { INVISIBLE_CHARS_PATTERN } from '../_shared/text-hygiene.js';

/** Stats tab windows (plan decision #11); the card always shows 30d. */
export const STATS_WINDOW_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;
/** `GET /skills` → `runs_30d`. */
export const LIST_RUNS_WINDOW_DAYS = 30;

/** `agent_runs.status` of a run that finished and produced a review. The
 *  plan says "completed"; the column's value for that state is 'done'. */
export const COMPLETED_RUN_STATUS = 'done';
