/** Constants for the agents module. */

/** Initial config version recorded for a newly-created agent. */
export const INITIAL_AGENT_VERSION = 1;

/** Default agent description when none is supplied on insert. */
export const DEFAULT_AGENT_DESCRIPTION = '';

/**
 * SPEC-02 non-functional: enabled-skills budget per agent — 24 KB of body
 * text (≈6k tokens). In map-reduce the skills block repeats per file chunk,
 * so cost scales with files × skills; the budget caps the per-call size.
 */
export const AGENT_SKILLS_BODY_BUDGET_BYTES = 24576;
