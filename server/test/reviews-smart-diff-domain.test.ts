import { describe, it, expect } from 'vitest';
import { classifyFile, ROLE_ORDER } from '@devdigest/reviewer-core';
import { SmartDiffResponse } from '@devdigest/shared/contracts/review-api';
import {
  buildSmartDiff as buildClassified,
  selectLatestPerAgent,
  type SmartDiffFileInput,
  type SmartDiffReviewInput,
} from '../src/modules/reviews/domain.js';

// The service classifies files before the domain groups them; mirror that here.
const buildSmartDiff = (files: readonly SmartDiffFileInput[], reviews: readonly SmartDiffReviewInput[]) =>
  buildClassified(
    files.map((f) => ({ ...f, role: classifyFile(f.path) })),
    reviews,
    ROLE_ORDER,
  );

const finding = (file: string, start_line: number, dismissed_at: string | null = null) => ({
  file,
  start_line,
  dismissed_at,
});
const review = (
  agent_id: string | null,
  created_at: string,
  findings: SmartDiffReviewInput['findings'] = [],
): SmartDiffReviewInput => ({ agent_id, created_at, findings });

describe('selectLatestPerAgent (D5)', () => {
  it('keeps only the newest review per agent, null being its own key, in any input order', () => {
    const aOld = review('A', '2026-01-01T00:00:00Z');
    const aNew = review('A', '2026-01-03T00:00:00Z');
    const b = review('B', '2026-01-02T00:00:00Z');
    const nOld = review(null, '2026-01-01T00:00:00Z');
    const nNew = review(null, '2026-01-04T00:00:00Z');
    const picked = selectLatestPerAgent([nOld, aNew, b, aOld, nNew]);
    expect(picked).toHaveLength(3);
    expect(picked).toEqual(expect.arrayContaining([aNew, b, nNew]));
  });
});

describe('buildSmartDiff', () => {
  const files = [
    { path: 'src/a.ts', additions: 3, deletions: 1 },
    { path: 'src/b.ts', additions: 2, deletions: 0 },
    { path: 'README.md', additions: 1, deletions: 1 },
  ];

  it('returns all five groups in ROLE_ORDER even when empty', () => {
    const out = buildSmartDiff([], []);
    expect(out.groups.map((g) => g.role)).toEqual(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
    expect(out.groups.every((g) => g.files.length === 0)).toBe(true);
  });

  it('keeps input order within a group and empty finding_lines without reviews', () => {
    const out = buildSmartDiff(files, []);
    expect(out.groups[0]?.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(out.groups[3]?.files.map((f) => f.path)).toEqual(['README.md']);
    expect(out.groups.flatMap((g) => g.files).every((f) => f.finding_lines.length === 0)).toBe(true);
  });

  it('finding_lines are distinct and ascending; dismissed excluded; unknown paths ignored', () => {
    const out = buildSmartDiff(files, [
      review('A', '2026-01-01T00:00:00Z', [
        finding('src/a.ts', 9),
        finding('src/a.ts', 4),
        finding('src/a.ts', 9),
        finding('src/a.ts', 7, '2026-01-02T00:00:00Z'),
        finding('nowhere.ts', 1),
      ]),
    ]);
    expect(out.groups[0]?.files[0]?.finding_lines).toEqual([4, 9]);
    expect(out.groups.flatMap((g) => g.files.map((f) => f.path))).not.toContain('nowhere.ts');
  });

  it('only the latest review per agent counts', () => {
    const out = buildSmartDiff(files, [
      review('B', '2026-01-02T00:00:00Z', [finding('src/b.ts', 2)]),
      review('A', '2026-01-03T00:00:00Z', [finding('src/a.ts', 5)]),
      review('A', '2026-01-01T00:00:00Z', [finding('src/a.ts', 1)]),
    ]);
    expect(out.groups[0]?.files.map((f) => f.finding_lines)).toEqual([[5], [2]]);
  });

  it('computes total_lines and a contract-valid body', () => {
    const out = buildSmartDiff(files, []);
    expect(out.split_suggestion).toEqual({ too_big: false, total_lines: 8, proposed_splits: [] });
    expect(() => SmartDiffResponse.parse(out)).not.toThrow();
  });
});
