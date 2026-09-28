import type { SkillType } from "@devdigest/shared";

/** The skills list route. */
export const SKILLS_HREF = "/skills";

/** Editor tab a link opens when it does not name one (and the fallback for an unknown `?tab=`). */
export const DEFAULT_EDITOR_TAB = "config";

/** Selectable skill types — Config tab and the create flow. */
export const SKILL_TYPE_OPTIONS: readonly SkillType[] = ["rubric", "convention", "security", "custom"];
