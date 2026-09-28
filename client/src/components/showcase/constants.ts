import { SEVERITY_ORDER } from "@devdigest/ui";

/** Constants for the Showcase Gallery (dev-only). */

export const SEVERITIES = SEVERITY_ORDER;

export const CATEGORIES = ["bug", "security", "perf", "style", "test"] as const;

export const MODEL_OPTIONS = ["gpt-4.1", "gpt-4o", "claude-sonnet"] as const;
