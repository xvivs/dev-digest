/** Width (px) of the Create-skill modal. */
export const MODAL_WIDTH = 760;
/** Rows of the body editor textarea. */
export const BODY_ROWS = 14;
/** Body view modes (AC-44): the editable text, or the raw source with invisible characters marked. */
export const BODY_VIEWS = ["edit", "raw"] as const;
export type BodyView = (typeof BODY_VIEWS)[number];
export const DEFAULT_BODY_VIEW: BodyView = "edit";
/** The only type a skill made from conventions can have (D16). */
export const FIXED_SKILL_TYPE = "convention";
/** Ids of the labelled form controls. */
export const FIELD_IDS = {
  name: "convention-skill-name",
  description: "convention-skill-description",
  type: "convention-skill-type",
  agents: "convention-skill-agents",
} as const;
/** Width (px) of the discard-changes confirmation. */
export const DISCARD_MODAL_WIDTH = 420;
/** Options of the fixed, disabled Type select (a module constant so the array is stable across renders). */
export const FIXED_SKILL_OPTIONS: string[] = [FIXED_SKILL_TYPE];
/** Stable empty list for query data that has not arrived. */
export const EMPTY: readonly never[] = [];

/** Server codes the create call answers with (AC-25, AC-27, AC-28). */
export const CREATE_ERROR_CODES = {
  nameTaken: "skill_name_taken",
  budgetExceeded: "agent_skills_budget_exceeded",
  notAccepted: "convention_not_accepted",
} as const;

/** Skill-name rule the server enforces (`^[a-z0-9][a-z0-9-]{1,63}$`). */
export const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const SKILL_NAME_MAX_LENGTH = 64;
export const SKILL_NAME_SUFFIX = "-conventions";

/** A snippet enters the skill body with at most this many lines (AC-43). */
export const SNIPPET_MAX_LINES = 12;
/** Shortest fence Markdown accepts; a longer one is used when the snippet contains backticks. */
export const MIN_FENCE_LENGTH = 3;
/** Longest section heading slug, so a 300-char rule does not become a 300-char heading. */
export const HEADING_SLUG_MAX_LENGTH = 48;

/** Enabled-skills budget per agent: 24 KB of body text (server `AGENT_SKILLS_BODY_BUDGET_BYTES`). */
export const AGENT_SKILLS_BUDGET_BYTES = 24576;
/** "Attach to agents" accepts at most this many agents (AC-45, `agent_ids` max). */
export const MAX_ATTACHED_AGENTS = 20;
