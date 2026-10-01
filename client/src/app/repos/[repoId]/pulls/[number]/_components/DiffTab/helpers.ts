/* Pure domain helpers for DiffTab: which findings count, grouping files by
   role, counters, the shared visibility toggle. No React. */
import { SmartDiffRole } from "@devdigest/shared";
import type { FindingRecord, PrFile, ReviewRecord, SmartDiff } from "@devdigest/shared";
import { findingsForFile, isActiveFinding } from "@/components/diff-viewer/findings";
import { COLLAPSED_ROLES, FALLBACK_ROLE } from "./constants";

/**
 * Client copy of server `selectLatestPerAgent` (`server/src/modules/reviews/domain.ts`);
 * keep the two rules identical. Latest review per agent (null is its own key),
 * by `created_at`, all its findings flattened.
 */
export function selectDiffFindings(reviews: readonly ReviewRecord[]): FindingRecord[] {
  const latest = new Map<string | null, ReviewRecord>();
  for (const r of reviews) {
    const cur = latest.get(r.agent_id);
    if (!cur || Date.parse(r.created_at) > Date.parse(cur.created_at)) latest.set(r.agent_id, r);
  }
  return [...latest.values()].flatMap((r) => r.findings);
}

export interface RoleGroup {
  role: SmartDiffRole;
  files: PrFile[];
  isEmpty: boolean;
}

/**
 * All five roles in `SmartDiffRole.options` order. A file takes the role the
 * response gives its path, else `core`; files keep `pr.files` order.
 */
export function groupFilesByRole(files: readonly PrFile[], smartDiff: SmartDiff): RoleGroup[] {
  const roleByPath = new Map<string, SmartDiffRole>();
  for (const g of smartDiff.groups) for (const f of g.files) roleByPath.set(f.path, g.role);
  return SmartDiffRole.options.map((role) => {
    const inRole = files.filter((f) => (roleByPath.get(f.path) ?? FALLBACK_ROLE) === role);
    return { role, files: inRole, isEmpty: inRole.length === 0 };
  });
}

/** Paths of every file in a group whose role starts collapsed (docs, boilerplate). */
export function collapsedPathsFor(groups: readonly RoleGroup[]): Set<string> {
  return new Set(groups.filter((g) => COLLAPSED_ROLES.has(g.role)).flatMap((g) => g.files.map((f) => f.path)));
}

/** Files of `files` with at least one active finding. */
export function countFilesWithFindings(files: readonly PrFile[], findings: readonly FindingRecord[]): number {
  return files.filter((f) => findingsForFile(findings, f.path).some(isActiveFinding)).length;
}

/** Findings whose file is not in the PR (renamed away, stale path). */
export function unmatchedFileFindings(files: readonly PrFile[], findings: readonly FindingRecord[]): FindingRecord[] {
  const paths = new Set(files.map((f) => f.path));
  return findings.filter((f) => !paths.has(f.file));
}

export function summarize(files: readonly PrFile[]): { count: number; additions: number; deletions: number } {
  return {
    count: files.length,
    additions: files.reduce((n, f) => n + (f.additions ?? 0), 0),
    deletions: files.reduce((n, f) => n + (f.deletions ?? 0), 0),
  };
}

export type ToggleLabelKey =
  | "showComments"
  | "hideComments"
  | "showAll"
  | "showCommentsAndFindings"
  | "hideCommentsAndFindings";

/**
 * The shared comments + findings toggle. `state` is the user's override
 * (`null` = untouched). `findingCount` counts every diff finding (dismissed
 * included, they still render), `activeFindingCount` only the ones that count.
 * Returns the `prReview.diff` label key, its `{count}`, whether the button
 * renders, and the override a click sets.
 *
 * With no findings the button is today's comment-only toggle. With findings and
 * no comments an untouched toggle already shows everything, so it reads "hide".
 */
export function toggleLabel(
  state: boolean | null,
  counts: { commentCount: number; findingCount: number; activeFindingCount: number },
): { key: ToggleLabelKey; count: number; visible: boolean; next: boolean } {
  const { commentCount, findingCount, activeFindingCount } = counts;
  const visible = commentCount + findingCount > 0;
  if (findingCount === 0) {
    const shown = state ?? false;
    return { key: shown ? "hideComments" : "showComments", count: commentCount, visible, next: !shown };
  }
  const count = commentCount + activeFindingCount;
  const effective = state === null && commentCount === 0 ? true : state;
  if (effective === null) return { key: "showAll", count, visible, next: true };
  if (effective) return { key: "hideCommentsAndFindings", count, visible, next: false };
  return { key: "showCommentsAndFindings", count, visible, next: true };
}
