import type { Severity, SeverityCounts } from "@devdigest/shared";

/**
 * The three filterable severities in display order, each paired with the
 * lowercase key it uses BOTH in `SeverityCounts` and in the i18n message tree
 * (`prReview.panel.counts.*` / `prReview.panel.filter.*`). One table keeps the
 * tally row, the filter row and the copy from drifting apart.
 *
 * `INFO` is deliberately absent: `Severity` from `@devdigest/shared` has three
 * members, the four-member `Severity` in `@devdigest/ui` is a different type.
 */
export const SEVERITY_LEVELS = [
  { severity: "CRITICAL", key: "critical" },
  { severity: "WARNING", key: "warning" },
  { severity: "SUGGESTION", key: "suggestion" },
] as const satisfies ReadonlyArray<{ severity: Severity; key: keyof SeverityCounts }>;
