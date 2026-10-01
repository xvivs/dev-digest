import { describe, it, expect } from 'vitest';
import {
  blastSource,
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

const key: BlastKey = {
  headSha: 'h',
  sourceSha: 's',
  indexerVersion: 1,
  indexStatus: 'full',
  repoIntelEnabled: true,
  mappingVersion: 1,
};

describe('toBlastRadius', () => {
  it('attaches endpoints and crons per symbol from the caller files, not across symbols', () => {
    const r = toBlastRadius(
      input({
        changedSymbols: [
          { name: 'a', file: 'src/a.ts', kind: 'function' },
          { name: 'b', file: 'src/b.ts', kind: 'function' },
        ],
        callers: [
          { file: 'src/routes.ts', symbol: 'h1', viaSymbol: 'a', line: 3, rank: 0 },
          { file: 'src/jobs.ts', symbol: 'h2', viaSymbol: 'b', line: 9, rank: 0 },
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
        callers: [{ file: 'src/x.ts', symbol: 'h', viaSymbol: 'a', line: 1, rank: 0 }],
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
          { file: 'src/r1.ts', symbol: 'x', viaSymbol: 'run', line: 1, rank: 0 },
          { file: 'src/r2.ts', symbol: 'y', viaSymbol: 'run', line: 2, rank: 0 },
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

  it('summary counts changed symbols (not downstream groups) so it matches changed_symbols.length', () => {
    const r = toBlastRadius(
      input({
        changedSymbols: [
          { name: 'run', file: 'src/a.ts', kind: 'function' },
          { name: 'run', file: 'src/b.ts', kind: 'function' },
        ],
      }),
    );
    expect(r.downstream).toHaveLength(1);
    expect(r.changed_symbols).toHaveLength(2);
    expect(r.summary).toBe('2 changed symbol(s) with 0 caller(s); 0 endpoint(s) and 0 cron(s) affected.');
  });
});

describe('toBlastRadius ordering and self-caller guard', () => {
  const sym = (name: string, file = `src/${name}.ts`) => ({ name, file, kind: 'function' });
  const call = (via: string, symbol: string, file: string, line: number, rank: number) => ({
    file,
    symbol,
    viaSymbol: via,
    line,
    rank,
  });

  it('orders callers by rank desc, file, line', () => {
    const r = toBlastRadius(
      input({
        changedSymbols: [sym('a')],
        callers: [
          call('a', 'x', 'src/z.ts', 1, 1),
          call('a', 'y', 'src/b.ts', 9, 5),
          call('a', 'w', 'src/b.ts', 2, 5),
          call('a', 'v', 'src/a2.ts', 7, 5),
        ],
      }),
    );
    expect(r.downstream[0]!.callers.map((c) => `${c.file}:${c.line}`)).toEqual([
      'src/a2.ts:7',
      'src/b.ts:2',
      'src/b.ts:9',
      'src/z.ts:1',
    ]);
  });

  it('orders groups by max rank, then caller count, then symbol; zero-caller group last', () => {
    const r = toBlastRadius(
      input({
        changedSymbols: [sym('zero'), sym('low'), sym('hiB'), sym('hiA'), sym('many')],
        callers: [
          call('low', 'c', 'src/c.ts', 1, 1),
          call('hiB', 'c', 'src/c.ts', 1, 9),
          call('hiA', 'c', 'src/c.ts', 2, 9),
          call('many', 'c', 'src/c.ts', 3, 9),
          call('many', 'd', 'src/d.ts', 3, 2),
        ],
      }),
    );
    expect(r.downstream.map((d) => d.symbol)).toEqual(['many', 'hiA', 'hiB', 'low', 'zero']);
    expect(r.changed_symbols.map((s) => s.name)).toEqual(['many', 'hiA', 'hiB', 'low', 'zero']);
  });

  it('is deterministic when every rank is 0 (fallback path)', () => {
    const r = toBlastRadius(
      input({
        changedSymbols: [sym('b'), sym('a')],
        callers: [call('b', 'x', 'src/x.ts', 1, 0), call('a', 'y', 'src/y.ts', 1, 0)],
      }),
    );
    expect(r.downstream.map((d) => d.symbol)).toEqual(['a', 'b']);
  });

  it('changed_symbols with the same name tie-break by file', () => {
    const r = toBlastRadius(
      input({ changedSymbols: [sym('run', 'src/b.ts'), sym('run', 'src/a.ts')] }),
    );
    expect(r.changed_symbols.map((s) => s.file)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('drops a caller living in the declaring file of its viaSymbol, keeps other files', () => {
    const r = toBlastRadius(
      input({
        changedSymbols: [sym('a', 'src/a.ts'), sym('b', 'src/b.ts')],
        callers: [
          call('a', 'self', 'src/a.ts', 3, 1),
          call('a', 'other', 'src/c.ts', 4, 1),
          call('b', 'fromA', 'src/a.ts', 5, 1),
        ],
      }),
    );
    expect(r.downstream.find((d) => d.symbol === 'a')!.callers).toEqual([{ name: 'other', file: 'src/c.ts', line: 4 }]);
    expect(r.downstream.find((d) => d.symbol === 'b')!.callers).toEqual([{ name: 'fromA', file: 'src/a.ts', line: 5 }]);
  });
});

describe('blastVerdict (status mapping table)', () => {
  it.each([
    [false, 'full', false, { status: 'degraded', reason: 'flag_off' }],
    [false, 'partial', false, { status: 'degraded', reason: 'flag_off' }],
    [true, 'partial', false, { status: 'degraded', reason: 'index_partial' }],
    [true, 'partial', true, { status: 'degraded', reason: 'index_partial' }],
    [true, 'full', false, { status: 'ok', reason: null }],
    [true, 'full', true, { status: 'degraded', reason: 'no_data' }],
    [true, 'none', false, { status: 'degraded', reason: 'no_data' }],
    [true, 'failed', false, { status: 'degraded', reason: 'index_failed' }],
  ])('enabled=%s index=%s degraded=%s -> %j', (enabled, status, degraded, expected) => {
    expect(blastVerdict(enabled, input({ index: index(status), degraded }))).toEqual(expected);
  });

  it('full + fallback result reports the facade reason', () => {
    expect(blastVerdict(true, input({ degraded: true, reason: 'repo_too_large' }))).toEqual({
      status: 'degraded',
      reason: 'repo_too_large',
    });
  });

  it.each([
    ['failed', 'repo_too_large', 'repo_too_large'],
    ['degraded', undefined, 'no_data'],
    ['degraded', 'index_failed', 'index_failed'],
    ['none', 'no_data', 'no_data'],
  ] as const)('index=%s degradedReason=%s -> %s, never no_index', (status, degradedReason, expected) => {
    const v = blastVerdict(true, input({ index: { ...index(status), degradedReason } }));
    expect(v).toEqual({ status: 'degraded', reason: expected });
  });
});

describe('blastSource', () => {
  const k = (indexStatus: string, repoIntelEnabled = true): BlastKey => ({ ...key, indexStatus, repoIntelEnabled });
  it.each([
    ['full', true, 'index'],
    ['partial', true, 'index'],
    ['full', false, 'ripgrep_fallback'],
    ['none', true, 'ripgrep_fallback'],
    ['failed', true, 'ripgrep_fallback'],
  ] as const)('status=%s enabled=%s -> %s', (status, enabled, expected) => {
    expect(blastSource(k(status, enabled))).toBe(expected);
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
  const base = key;
  it('is equal only when every field is equal', () => {
    expect(sameBlastKey(base, { ...base })).toBe(true);
    for (const change of [
      { headSha: 'h2' },
      { sourceSha: 's2' },
      { indexerVersion: 2 },
      { indexStatus: 'partial' },
      { repoIntelEnabled: false },
      { mappingVersion: 0 },
    ]) {
      expect(sameBlastKey(base, { ...base, ...change })).toBe(false);
    }
  });
});
