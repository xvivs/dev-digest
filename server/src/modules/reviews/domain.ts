/**
 * Smart Diff domain rules (pure: no I/O, no container, no runtime zod).
 *
 * `selectLatestPerAgent` is the policy "the latest review per agent counts".
 * The client keeps a copy in `DiffTab/helpers.ts` (`selectDiffFindings`); keep
 * the two rules identical.
 */
import { classifyFile, ROLE_ORDER } from '@devdigest/reviewer-core';
import type { SmartDiff, SmartDiffRole } from '@devdigest/shared';

export interface SmartDiffFileInput {
  path: string;
  additions: number;
  deletions: number;
}

export interface SmartDiffFindingInput {
  file: string;
  start_line: number;
  dismissed_at: string | null;
}

export interface SmartDiffReviewInput {
  agent_id: string | null;
  created_at: string;
  findings: SmartDiffFindingInput[];
}

/** For each `agent_id` (null is its own key) keep the newest review by `created_at`. */
export function selectLatestPerAgent<R extends { agent_id: string | null; created_at: string }>(
  reviews: readonly R[],
): R[] {
  const latest = new Map<string | null, R>();
  for (const review of reviews) {
    const current = latest.get(review.agent_id);
    if (!current || Date.parse(review.created_at) > Date.parse(current.created_at)) {
      latest.set(review.agent_id, review);
    }
  }
  return [...latest.values()];
}

/** Group files by role (all five groups, in ROLE_ORDER) and attach active-finding lines. */
export function buildSmartDiff(
  files: readonly SmartDiffFileInput[],
  reviews: readonly SmartDiffReviewInput[],
): SmartDiff {
  const linesByPath = new Map<string, Set<number>>();
  for (const review of selectLatestPerAgent(reviews)) {
    for (const f of review.findings) {
      if (f.dismissed_at !== null) continue;
      const lines = linesByPath.get(f.file) ?? new Set<number>();
      lines.add(f.start_line);
      linesByPath.set(f.file, lines);
    }
  }

  const byRole = new Map<SmartDiffRole, SmartDiff['groups'][number]['files']>(
    ROLE_ORDER.map((role) => [role, []]),
  );
  let totalLines = 0;
  for (const file of files) {
    totalLines += file.additions + file.deletions;
    byRole.get(classifyFile(file.path))?.push({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      finding_lines: [...(linesByPath.get(file.path) ?? [])].sort((a, b) => a - b),
    });
  }

  return {
    groups: ROLE_ORDER.map((role) => ({ role, files: byRole.get(role) ?? [] })),
    split_suggestion: { too_big: false, total_lines: totalLines, proposed_splits: [] },
  };
}
