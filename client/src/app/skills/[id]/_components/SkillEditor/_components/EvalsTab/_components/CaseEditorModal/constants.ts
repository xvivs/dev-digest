import type { FindingCategory, Severity } from "@devdigest/shared";

/** Width (px) of the case editor modal. */
export const CASE_MODAL_WIDTH = 760;

/** Rows of the paste-diff textarea. */
export const DIFF_ROWS = 12;

/** Select options, strongest first (labels are the contract values, shown mono). */
export const SEVERITY_OPTIONS: readonly Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];
export const CATEGORY_OPTIONS: readonly FindingCategory[] = ["bug", "security", "perf", "style", "test"];

/** A new must_find row starts at the middle severity and the most common category. */
export const DEFAULT_ROW_SEVERITY: Severity = "WARNING";
export const DEFAULT_ROW_CATEGORY: FindingCategory = "bug";
