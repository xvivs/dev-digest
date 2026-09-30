import { describe, it, expect } from 'vitest';
import {
  blastVerdict,
  sameBlastKey,
  sourceShaFor,
  toBlastRadius,
  type BlastInput,
  type BlastKey,
} from '../src/modules/blast/domain.js';

const index = (status: string, sha = 'idx1', v = 3) => ({ status, lastIndexedSha: sha, indexerVersion: v });

const input = (over: Partial<BlastInput> = {}): BlastInput => ({
  changedSymbols: [],
  callers: [],
  index: index('full'),
  ...over,
});

describe('toBlastRadius', () => {
  it('attaches endpoints and crons per symbol from the caller files, not across symbols', () => {
    const r = toBlastRadius(
      input({
        changedSymbols: [
          { name: 'a', file: 'src/a.ts', kind: 'function' },
          { name: 'b', file: 'src/b.ts', kind: 'function' },
        ],
        callers: [
          { file: 'src/routes.ts', symbol: 'h1', viaSymbol: 'a', line: 3 },
          { file: 'src/jobs.ts', symbol: 'h2', viaSymbol: 'b', line: 9 },
        ],
        factsByFile: {
          'src/routes.ts': { endpoints: ['GET /x'], crons: [] },
          'src/jobs.ts': { endpoints: [], crons: ['0 * * * *'] },
        },
      }),
    );
    const a = r.downstream.find((d) => d.symbol === 'a')!;
    const b = r.downstream.find((d) => d.symbol === 'b')!;
    expect(a.endpoints_affected).toEqual(['GET /x']);
    expect(a.crons_affected).toEqual([]);
    expect(b.endpoints_affected).toEqual([]);
    expect(b.crons_affected).toEqual(['0 * * * *']);
    expect(a.callers).toEqual([{ name: 'h1', file: 'src/routes.ts', line: 3 }]);
    expect(r.summary).toBe('2 changed symbol(s) with 2 caller(s); 1 endpoint(s) and 1 cron(s) affected.');
  });

  it('without factsByFile (degraded path) the arrays are empty, callers kept', () => {
    const r = toBlastRadius(
      input({
        changedSymbols: [{ name: 'a', file: 'src/a.ts', kind: 'function' }],
        callers: [{ file: 'src/x.ts', symbol: 'h', viaSymbol: 'a', line: 1 }],
      }),
    );
    expect(r.downstream[0]).toMatchObject({ endpoints_affected: [], crons_affected: [] });
    expect(r.downstream[0]!.callers).toHaveLength(1);
  });

  it('merges two same-named symbols into one downstream entry and dedupes shared endpoints', () => {
    const r = toBlastRadius(
      input({
        changedSymbols: [
          { name: 'run', file: 'src/a.ts', kind: 'function' },
          { name: 'run', file: 'src/b.ts', kind: 'method' },
        ],
        callers: [
          { file: 'src/r1.ts', symbol: 'x', viaSymbol: 'run', line: 1 },
          { file: 'src/r2.ts', symbol: 'y', viaSymbol: 'run', line: 2 },
        ],
        factsByFile: {
          'src/r1.ts': { endpoints: ['GET /x'], crons: [] },
          'src/r2.ts': { endpoints: ['GET /x'], crons: [] },
        },
      }),
    );
    expect(r.changed_symbols).toHaveLength(2);
    expect(r.downstream).toHaveLength(1);
    expect(r.downstream[0]!.endpoints_affected).toEqual(['GET /x']);
    expect(r.summary).toContain('1 endpoint(s)');
  });
});

describe('blastVerdict (status mapping table)', () => {
  it.each([
    [false, 'full', false, { status: 'degraded', reason: 'flag_off' }],
    [false, 'partial', false, { status: 'degraded', reason: 'flag_off' }],
    [true, 'partial', false, { status: 'degraded', reason: 'index_partial' }],
    [true, 'partial', true, { status: 'degraded', reason: 'index_partial' }],
    [true, 'full', false, { status: 'ok', reason: null }],
    [true, 'full', true, { status: 'degraded', reason: 'no_index' }],
    [true, 'none', false, { status: 'degraded', reason: 'no_index' }],
    [true, 'failed', false, { status: 'degraded', reason: 'no_index' }],
  ])('enabled=%s index=%s degraded=%s -> %j', (enabled, status, degraded, expected) => {
    expect(blastVerdict(enabled, input({ index: index(status), degraded }))).toEqual(expected);
  });
});

describe('sourceShaFor', () => {
  it('uses the index sha for full/partial, the clone head otherwise', () => {
    expect(sourceShaFor(index('full', 'I'), 'C')).toBe('I');
    expect(sourceShaFor(index('partial', 'I'), 'C')).toBe('I');
    expect(sourceShaFor(index('none', 'I'), 'C')).toBe('C');
    expect(sourceShaFor(index('failed', 'I'), '')).toBe('');
  });
});

describe('sameBlastKey', () => {
  const base: BlastKey = { headSha: 'h', sourceSha: 's', indexerVersion: 1, indexStatus: 'full', repoIntelEnabled: true };
  it('is equal only when every field is equal', () => {
    expect(sameBlastKey(base, { ...base })).toBe(true);
    for (const change of [
      { headSha: 'h2' },
      { sourceSha: 's2' },
      { indexerVersion: 2 },
      { indexStatus: 'partial' },
      { repoIntelEnabled: false },
    ]) {
      expect(sameBlastKey(base, { ...base, ...change })).toBe(false);
    }
  });
});
