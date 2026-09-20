/**
 * Severity tallying — pure, independently testable, shared by every surface
 * that renders a findings breakdown (PR list cell, review header, popover).
 *
 * `SEV_KEY` is the bridge between the two Severity vocabularies in this repo:
 * `@devdigest/shared` speaks UPPERCASE enum members (3 values), while
 * `SeverityCounts` (the wire shape the server's `rollupSeverities()` emits)
 * speaks lowercase keys. Typing it as `Record<Severity, keyof SeverityCounts>`
 * — literal keys, no index signature — is what keeps `SEV_KEY[sev]` free of
 * `| undefined` under `noUncheckedIndexedAccess`.
 *
 * Note: `@devdigest/ui`'s `Severity` is a DIFFERENT, wider union (it adds
 * `INFO`). Always take the type from `@devdigest/shared`; only the visual
 * tokens come from the UI package.
 */
import type { Severity, SeverityCounts } from "@devdigest/shared";

/** Empty tally. Treat as immutable — copy it (`{ ...ZERO_COUNTS }`) before writing. */
export const ZERO_COUNTS: SeverityCounts = { critical: 0, warning: 0, suggestion: 0 };

/** Render/sort order everywhere findings are shown: worst first. */
export const SEV_ORDER: readonly Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

export const SEV_KEY: Record<Severity, keyof SeverityCounts> = {
  CRITICAL: "critical",
  WARNING: "warning",
  SUGGESTION: "suggestion",
};

/**
 * `Object.hasOwn`, not `in`: `"toString" in SEV_KEY` is true through the
 * prototype chain, which would let a junk severity land on a real bucket.
 */
function isSeverity(raw: string): raw is Severity {
  return Object.hasOwn(SEV_KEY, raw);
}

/**
 * Tally findings by severity.
 *
 * Takes `{ severity: string }` rather than `Severity` on purpose: the column is
 * `text` in Postgres (`server/src/db/schema/reviews.ts`), not an enum, so a row
 * written by an older agent version can carry anything. Unknown values are
 * dropped — never bucketed into a neighbouring severity, which would silently
 * inflate a count the user is about to act on.
 */
export function countBySeverity(fs: { severity: string }[]): SeverityCounts {
  const counts: SeverityCounts = { ...ZERO_COUNTS };
  for (const f of fs) {
    if (isSeverity(f.severity)) counts[SEV_KEY[f.severity]] += 1;
  }
  return counts;
}

/** The severities with at least one finding, worst first. */
export function presentSeverities(c: SeverityCounts): Severity[] {
  return SEV_ORDER.filter((sev) => c[SEV_KEY[sev]] > 0);
}
