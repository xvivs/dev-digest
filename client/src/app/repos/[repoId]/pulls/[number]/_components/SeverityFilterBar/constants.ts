import type { Severity, SeverityCounts } from "@devdigest/shared";

/**
 * The three filterable severities in display order, each paired with the
 * lowercase key it uses BOTH in `SeverityCounts` and in the i18n message tree
 * (`prReview.panel.counts.*` / `prReview.panel.filter.*`). One table keeps the
 * tally row, the filter row and the copy from drifting apart.
 *
 * `INFO` is deliberately absent: no finding carries it. `Severity` from
 * `@devdigest/shared` has three members; `@devdigest/ui`'s adds `INFO` for
 * non-finding UI (ADR 0008).
 */
export const SEVERITY_LEVELS = [
  { severity: "CRITICAL", key: "critical" },
  { severity: "WARNING", key: "warning" },
] as const satisfies ReadonlyArray<{ severity: Severity; key: keyof SeverityCounts }>;
