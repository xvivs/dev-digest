import type { FindingRecord, Severity } from "@devdigest/shared";
import { compareSeverity } from "@devdigest/ui";
import { LOW_CONFIDENCE_THRESHOLD } from "./constants";

/**
 * The confidence gate + severity sort, i.e. everything the severity filter is
 * applied ON TOP OF.
 *
 * Split out from `bySeverity` on purpose: the counters in the toolbar are
 * tallied from THIS array, so a pill reading "2 WARNING" is a promise that
 * selecting Warning renders exactly two cards. Counting the raw `findings`
 * instead would over-report as soon as "hide low confidence" is on.
 */
export function baseFindings(
  findings: FindingRecord[],
  opts: { hideLow: boolean },
): FindingRecord[] {
  const kept = opts.hideLow
    ? findings.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD)
    : findings;
  return [...kept].sort((a, b) => compareSeverity(a.severity, b.severity));
}

/** Narrow a `baseFindings` result to one severity. `null` = no filter. */
export function bySeverity(base: FindingRecord[], severity: Severity | null): FindingRecord[] {
  return severity == null ? base : base.filter((f) => f.severity === severity);
}
