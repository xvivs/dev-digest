/**
 * DOMAIN — pure prior-PR history rules. No I/O.
 */
import type { PrHistoryItem } from '@devdigest/shared';
import { HISTORY_MAX_ITEMS, HISTORY_MAX_PATHS, HISTORY_TTL_MS } from './constants.js';

export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
}

/** One (path, PR) pair as the GitHub adapter returns it. */
export interface PathHistoryInput {
  path: string;
  number: number;
  title: string;
  author: string;
  mergedAt: string | null;
}

/** Top `HISTORY_MAX_PATHS` changed files by churn (ties: path order). */
export function pickPaths(files: ChangedFile[]): string[] {
  return [...files]
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions) || a.path.localeCompare(b.path))
    .slice(0, HISTORY_MAX_PATHS)
    .map((f) => f.path);
}

/** Merged PRs only, minus the PR itself, grouped by number, newest first, capped. */
export function buildHistory(rows: PathHistoryInput[], selfNumber: number): PrHistoryItem[] {
  const byNumber = new Map<number, { item: PrHistoryItem; paths: Set<string> }>();
  for (const r of rows) {
    if (r.mergedAt == null || r.number === selfNumber) continue;
    const hit = byNumber.get(r.number);
    if (hit) {
      hit.paths.add(r.path);
      continue;
    }
    byNumber.set(r.number, {
      item: {
        pr_number: r.number,
        title: r.title,
        merged_at: r.mergedAt,
        author: r.author,
        files_overlap: [],
        notes: '',
      },
      paths: new Set([r.path]),
    });
  }
  return [...byNumber.values()]
    .map(({ item, paths }) => ({ ...item, files_overlap: [...paths].sort() }))
    .sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at) || b.pr_number - a.pr_number)
    .slice(0, HISTORY_MAX_ITEMS);
}

export interface HistoryKey {
  headSha: string;
  base: string;
  pathsHash: string;
}

export function isHistoryFresh(
  cached: HistoryKey & { computedAt: Date },
  key: HistoryKey,
  nowMs: number,
): boolean {
  return (
    cached.headSha === key.headSha &&
    cached.base === key.base &&
    cached.pathsHash === key.pathsHash &&
    nowMs - cached.computedAt.getTime() < HISTORY_TTL_MS
  );
}
