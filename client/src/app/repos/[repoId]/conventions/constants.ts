import type { ConventionCategory } from "@devdigest/shared";

/** Tabs of the candidates list. `all` = pending + accepted; rejected ones live in their own tab (D8). */
export const TAB_KEYS = ["all", "accepted", "rejected"] as const;
export type TabKey = (typeof TAB_KEYS)[number];
export const DEFAULT_TAB: TabKey = "all";

/** Categories, in the order the edit dropdown lists them (D16). */
export const CATEGORY_OPTIONS: readonly ConventionCategory[] = [
  "naming",
  "structure",
  "error-handling",
  "async",
  "typing",
  "testing",
  "imports",
  "api",
  "other",
];

/** Confidence tones (D16): >= 80% green, 60-79% amber, below 60% red. */
export type ConfidenceTone = "high" | "medium" | "low";
export const CONFIDENCE_HIGH_PCT = 80;
export const CONFIDENCE_MEDIUM_PCT = 60;

/** The rule text bounds the server enforces on PATCH (AC-5). */
export const RULE_MIN_LENGTH = 8;
export const RULE_MAX_LENGTH = 300;

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
/** `convention_ids` max on `POST /repos/:id/conventions/skills` (AC-6). */
export const MAX_SKILL_CONVENTIONS = 50;
