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

/** `convention_ids` max on `POST /repos/:id/conventions/skills` (AC-6). */
export const MAX_SKILL_CONVENTIONS = 50;

/** HTTP statuses the screens branch on. */
export const CONFLICT_STATUS = 409;
export const UNPROCESSABLE_STATUS = 422;

/** Failures of these mutations render inline, so the global toast stays silent (ADR 0011). */
export const LOCAL_ERRORS = { meta: { errorSurface: "local" } } as const;

/** Error codes a failed scan or a blocked extract carries; each has copy in `errors.<code>`. */
export const KNOWN_ERROR_CODES = [
  "scan_deadline_exceeded",
  "empty_sample",
  "head_moved",
  "repo_not_indexed",
  "repo_not_cloned",
  "repo_not_found",
  "interrupted",
] as const;
export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];
