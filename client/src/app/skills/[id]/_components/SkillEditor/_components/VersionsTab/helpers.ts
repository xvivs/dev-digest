import type { SkillVersionSummary } from "@devdigest/shared";

/**
 * One row of the Versions list. A `gap` is a version the skill passed through
 * but has no snapshot for: bodies before ADR 0016 were never stored, and the
 * UI says so instead of hiding the number.
 */
export type VersionRow =
  | { kind: "snapshot"; version: number; summary: SkillVersionSummary; isCurrent: boolean; hasPrevSnapshot: boolean }
  | { kind: "gap"; version: number };

/** Every version from the newest (current or latest snapshot) down to v1, newest first. */
export function buildVersionRows(summaries: readonly SkillVersionSummary[], currentVersion: number): VersionRow[] {
  const byVersion = new Map(summaries.map((s) => [s.version, s]));
  const newest = Math.max(currentVersion, ...summaries.map((s) => s.version));
  const rows: VersionRow[] = [];
  for (let version = newest; version >= 1; version--) {
    const summary = byVersion.get(version);
    rows.push(
      summary
        ? { kind: "snapshot", version, summary, isCurrent: version === currentVersion, hasPrevSnapshot: byVersion.has(version - 1) }
        : { kind: "gap", version },
    );
  }
  return rows;
}
