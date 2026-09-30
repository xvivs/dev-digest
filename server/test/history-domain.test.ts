import { describe, it, expect } from 'vitest';
import { buildHistory, isHistoryFresh, pickPaths, type PathHistoryInput } from '../src/modules/history/domain.js';
import { HISTORY_MAX_ITEMS, HISTORY_MAX_PATHS, HISTORY_TTL_MS } from '../src/modules/history/constants.js';

const f = (path: string, additions: number, deletions = 0) => ({ path, additions, deletions });

describe('pickPaths', () => {
  it('orders by churn (additions + deletions), ties by path, and caps at 10', () => {
    expect(pickPaths([f('b.ts', 1, 1), f('a.ts', 2, 0), f('big.ts', 5, 5), f('c.ts', 0, 1)])).toEqual([
      'big.ts',
      'a.ts',
      'b.ts',
      'c.ts',
    ]);
    const many = Array.from({ length: 15 }, (_, i) => f(`f${String(i).padStart(2, '0')}.ts`, i));
    const picked = pickPaths(many);
    expect(picked).toHaveLength(HISTORY_MAX_PATHS);
    expect(picked[0]).toBe('f14.ts');
    expect(picked).not.toContain('f00.ts');
  });

  it('does not mutate its input', () => {
    const files = [f('b.ts', 1), f('a.ts', 9)];
    pickPaths(files);
    expect(files.map((x) => x.path)).toEqual(['b.ts', 'a.ts']);
  });
});

describe('buildHistory', () => {
  const row = (number: number, path: string, mergedAt: string | null = '2026-01-10T00:00:00Z'): PathHistoryInput => ({
    path,
    number,
    title: `PR ${number}`,
    author: 'sam',
    mergedAt,
  });

  it('drops unmerged rows and the PR itself', () => {
    const out = buildHistory([row(1, 'a.ts'), row(2, 'a.ts', null), row(99, 'a.ts')], 99);
    expect(out.map((i) => i.pr_number)).toEqual([1]);
  });

  it('groups by PR number with sorted overlap paths and empty notes', () => {
    const out = buildHistory([row(5, 'z.ts'), row(5, 'a.ts'), row(5, 'z.ts')], 1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ pr_number: 5, files_overlap: ['a.ts', 'z.ts'], notes: '', author: 'sam' });
  });

  it('sorts newest first (ties by higher number) and caps at 10', () => {
    const out = buildHistory(
      [
        row(1, 'a.ts', '2026-01-01T00:00:00Z'),
        row(2, 'a.ts', '2026-03-01T00:00:00Z'),
        row(3, 'a.ts', '2026-03-01T00:00:00Z'),
      ],
      100,
    );
    expect(out.map((i) => i.pr_number)).toEqual([3, 2, 1]);
    const many = Array.from({ length: 14 }, (_, i) => row(i + 1, 'a.ts', `2026-02-${String(i + 1).padStart(2, '0')}T00:00:00Z`));
    const capped = buildHistory(many, 100);
    expect(capped).toHaveLength(HISTORY_MAX_ITEMS);
    expect(capped[0]!.pr_number).toBe(14);
  });
});

describe('isHistoryFresh', () => {
  const key = { headSha: 'h', base: 'main', pathsHash: 'p' };
  const t0 = Date.parse('2026-06-01T00:00:00Z');
  const cached = { ...key, computedAt: new Date(t0) };

  it('is fresh just under the 6 h TTL and stale at the TTL', () => {
    expect(isHistoryFresh(cached, key, t0 + HISTORY_TTL_MS - 1)).toBe(true);
    expect(isHistoryFresh(cached, key, t0 + HISTORY_TTL_MS)).toBe(false);
  });

  it.each([{ headSha: 'h2' }, { base: 'dev' }, { pathsHash: 'q' }])('a changed key part %j is stale', (change) => {
    expect(isHistoryFresh(cached, { ...key, ...change }, t0 + 1)).toBe(false);
  });
});
