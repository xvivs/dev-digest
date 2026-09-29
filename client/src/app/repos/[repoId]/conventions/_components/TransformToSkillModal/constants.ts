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
