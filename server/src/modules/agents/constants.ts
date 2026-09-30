/** Constants for the agents module. */

/** Initial config version recorded for a newly-created agent. */
export const INITIAL_AGENT_VERSION = 1;

/** Default agent description when none is supplied on insert. */
export const DEFAULT_AGENT_DESCRIPTION = '';

// The skills body budget lives in `_shared/skill-budget.ts`; re-exported for existing importers.
export { AGENT_SKILLS_BODY_BUDGET_BYTES } from '../_shared/skill-budget.js';
