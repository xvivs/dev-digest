import type { IconName } from "@devdigest/ui";
import type { SkillAgentUsageStatus, SkillStatsWindow } from "@devdigest/shared";

/** Switcher order (skill-impact decision 11). Labels resolve under `skills.stats.window`. */
export const STATS_WINDOWS: readonly SkillStatsWindow[] = ["7d", "30d", "90d"];

/** The agents route and the agent editor tab that holds the per-skill link toggle.
 *  Kept local rather than importing a cousin route's constants (ADR 0010),
 *  as RunReviewDropdown does. */
export const AGENTS_HREF = "/agents";
export const AGENT_SKILLS_TAB = "skills";

/** How each agent's link status looks. Label + glyph carry it; colour reinforces. */
export const USAGE_STATUS_LOOK: Readonly<Record<SkillAgentUsageStatus, { color: string; bg: string; icon: IconName }>> = {
  effective: { color: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" },
  link_disabled: { color: "var(--text-muted)", bg: "var(--bg-hover)", icon: "Slash" },
  skill_disabled: { color: "var(--text-muted)", bg: "var(--bg-hover)", icon: "EyeOff" },
  blocked_by_vetting: { color: "var(--warn)", bg: "var(--warn-bg)", icon: "Lock" },
};

/** Loading placeholder (px). */
export const SKELETON_CARD_HEIGHT = 96;
export const SKELETON_CARDS = 3;
