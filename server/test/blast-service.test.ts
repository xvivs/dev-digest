/** Hermetic: every port is an in-memory fake. */
import { describe, it, expect } from 'vitest';
import type { BlastInput } from '../src/modules/blast/domain.js';
import type {
  BlastCacheEntry,
  BlastKeyParts,
  BlastPull,
  BlastStore,
} from '../src/modules/blast/ports.js';
import { BLAST_MAPPING_VERSION } from '../src/modules/blast/constants.js';
import { BlastService } from '../src/modules/blast/service.js';

const PULL: BlastPull = { id: 'pr1', repoId: 'repo1', headSha: 'head1' };

function setup(opts: {
  pull?: BlastPull | undefined;
  files?: string[];
  parts?: Partial<BlastKeyParts>;
  result?: Partial<Omit<BlastInput, 'index'>>;
  computeError?: Error;
} = {}) {
  const rows = new Map<string, BlastCacheEntry>();
  const infos: { obj: Record<string, unknown>; msg: string }[] = [];
  const calls = { blast: 0, key: 0, upsert: 0, blastFiles: [] as string[][] };
  let parts: BlastKeyParts = {
    enabled: true,
    indexState: { status: 'full', lastIndexedSha: 'idx1', indexerVersion: 3 },
    cloneHead: 'clone1',
    ...opts.parts,
  };
  let pull: BlastPull | undefined = 'pull' in opts ? opts.pull : PULL;
  const store: BlastStore = {
    get: async (id) => rows.get(id),
    upsert: async (id, e) => {
      calls.upsert += 1;
      rows.set(id, { ...e, computedAt: new Date() });
    },
  };
  const svc = new BlastService({
    store,
    pulls: {
      getPull: async () => pull,
      getPrFiles: async () => (opts.files ?? ['src/a.ts']).map((path) => ({ path })),
    },
    keys: {
      getKey: async () => {
        calls.key += 1;
        return parts;
      },
    },
    blast: {
      getBlastRadius: async (_repo, files) => {
        calls.blast += 1;
        calls.blastFiles.push(files);
        if (opts.computeError) throw opts.computeError;
        return {
          changedSymbols: [{ name: 'f', file: 'src/a.ts', kind: 'function' }],
          callers: [{ file: 'src/b.ts', symbol: 'g', viaSymbol: 'f', line: 2, rank: 0 }],
          ...opts.result,
        };
      },
    },
    log: {
      debug() {},
      info: (obj, msg) => {
        infos.push({ obj, msg });
      },
    },
  });
  return {
    svc,
    rows,
    calls,
    infos,
    setParts: (p: Partial<BlastKeyParts>) => (parts = { ...parts, ...p }),
    setPull: (p: BlastPull | undefined) => (pull = p),
  };
}

describe('BlastService.getForPull', () => {
  it('returns undefined for a PR outside the workspace and touches nothing else', async () => {
    const s = setup({ pull: undefined });
    expect(await s.svc.getForPull('ws', 'pr1')).toBeUndefined();
    expect(s.calls.key + s.calls.blast + s.calls.upsert).toBe(0);
  });

  it('no pr_files -> unavailable/no_changed_files, nothing computed or cached', async () => {
    const s = setup({ files: [] });
    const v = await s.svc.getForPull('ws', 'pr1');
    expect(v).toMatchObject({ status: 'unavailable', reason: 'no_changed_files', blast: null, cached: false, computedAt: null });
    expect(s.calls.blast).toBe(0);
    expect(s.rows.size).toBe(0);
  });

  it('computes once, caches, and serves the second read from the cache', async () => {
    const s = setup();
    const first = await s.svc.getForPull('ws', 'pr1');
    expect(first).toMatchObject({ status: 'ok', reason: null, cached: false, headSha: 'head1', sourceSha: 'idx1', indexStatus: 'full' });
    expect(first!.blast!.downstream[0]!.callers).toHaveLength(1);
    expect(s.calls.blastFiles).toEqual([['src/a.ts']]);
    const second = await s.svc.getForPull('ws', 'pr1');
    expect(second).toMatchObject({ status: 'ok', cached: true });
    expect(s.calls.blast).toBe(1);
    expect(s.calls.upsert).toBe(1);
  });

  it.each([
    ['head moved', () => ({ pull: { ...PULL, headSha: 'head2' } }) as const],
    ['index sha moved', () => ({ parts: { indexState: { status: 'full', lastIndexedSha: 'idx2', indexerVersion: 3 } } }) as const],
    ['indexer version bumped', () => ({ parts: { indexState: { status: 'full', lastIndexedSha: 'idx1', indexerVersion: 4 } } }) as const],
    ['index status changed', () => ({ parts: { indexState: { status: 'partial', lastIndexedSha: 'idx1', indexerVersion: 3 } } }) as const],
    ['flag flipped', () => ({ parts: { enabled: false } }) as const],
  ])('a changed key (%s) recomputes instead of serving the cache', async (_n, change) => {
    const s = setup();
    await s.svc.getForPull('ws', 'pr1');
    const c = change();
    if ('pull' in c) s.setPull(c.pull);
    if ('parts' in c) s.setParts(c.parts);
    const v = await s.svc.getForPull('ws', 'pr1');
    expect(v!.cached).toBe(false);
    expect(s.calls.blast).toBe(2);
  });

  it('with no usable index the source sha is the clone head, so a new clone head recomputes', async () => {
    const s = setup({ parts: { indexState: { status: 'none', lastIndexedSha: '', indexerVersion: 3 }, cloneHead: 'c1' } });
    const v = await s.svc.getForPull('ws', 'pr1');
    expect(v).toMatchObject({ sourceSha: 'c1', status: 'degraded', reason: 'no_data' });
    s.setParts({ cloneHead: 'c2' });
    expect((await s.svc.getForPull('ws', 'pr1'))!.cached).toBe(false);
    expect(s.calls.blast).toBe(2);
  });

  describe('status mapping', () => {
    it.each([
      ['flag off beats everything', { enabled: false }, {}, 'degraded', 'flag_off'],
      ['partial index', { indexState: { status: 'partial', lastIndexedSha: 'i', indexerVersion: 3 } }, {}, 'degraded', 'index_partial'],
      ['full + clean', {}, {}, 'ok', null],
      ['full + degraded result (ripgrep fallback)', {}, { degraded: true, reason: 'repo_too_large' }, 'degraded', 'repo_too_large'],
      ['full + degraded result without reason', {}, { degraded: true }, 'degraded', 'no_data'],
      ['no index', { indexState: { status: 'none', lastIndexedSha: '', indexerVersion: 3 } }, {}, 'degraded', 'no_data'],
      ['failed index', { indexState: { status: 'failed', lastIndexedSha: '', indexerVersion: 3 } }, {}, 'degraded', 'index_failed'],
      ['failed index with facade reason', { indexState: { status: 'failed', lastIndexedSha: '', indexerVersion: 3, degradedReason: 'repo_too_large' } }, {}, 'degraded', 'repo_too_large'],
    ] as const)('%s', async (_n, parts, result, status, reason) => {
      const s = setup({ parts: parts as Partial<BlastKeyParts>, result });
      expect(await s.svc.getForPull('ws', 'pr1')).toMatchObject({ status, reason });
    });
  });

  it('persists and reports truncation, and a cache hit keeps it', async () => {
    const s = setup({ result: { truncated: true } });
    expect((await s.svc.getForPull('ws', 'pr1'))!.truncated).toBe(true);
    expect([...s.rows.values()][0]!.truncated).toBe(true);
    expect(await s.svc.getForPull('ws', 'pr1')).toMatchObject({ cached: true, truncated: true });
  });

  it('a failing compute propagates and caches nothing', async () => {
    const s = setup({ computeError: new Error('rg crashed') });
    await expect(s.svc.getForPull('ws', 'pr1')).rejects.toThrow('rg crashed');
    expect(s.rows.size).toBe(0);
  });

  it('a cached row with an older mappingVersion is recomputed and overwritten', async () => {
    const s = setup();
    await s.svc.getForPull('ws', 'pr1');
    const row = s.rows.get('pr1')!;
    s.rows.set('pr1', { ...row, mappingVersion: 0, reason: 'no_index' });
    const v = await s.svc.getForPull('ws', 'pr1');
    expect(v!.cached).toBe(false);
    expect(s.calls.blast).toBe(2);
    expect(s.rows.get('pr1')).toMatchObject({ mappingVersion: BLAST_MAPPING_VERSION });
  });

  describe('info log (blast index read)', () => {
    it('logs once per read with the index source and reparse:false when the index serves it', async () => {
      const s = setup();
      await s.svc.getForPull('ws', 'pr1');
      await s.svc.getForPull('ws', 'pr1');
      expect(s.infos).toHaveLength(2);
      expect(s.infos[0]).toMatchObject({
        msg: 'blast index read',
        obj: {
          prId: 'pr1',
          repoId: 'repo1',
          indexStatus: 'full',
          sourceSha7: 'idx1',
          changedFiles: 1,
          symbols: 1,
          callers: 1,
          cached: false,
          source: 'index',
          reparse: false,
          status: 'ok',
          reason: null,
        },
      });
      expect(s.infos[1]!.obj).toMatchObject({ cached: true, source: 'index', reparse: false });
      expect(typeof s.infos[0]!.obj.durationMs).toBe('number');
    });

    it('computed read on the ripgrep fallback reports reparse:true; a cache hit reports false', async () => {
      const s = setup({ parts: { indexState: { status: 'none', lastIndexedSha: '', indexerVersion: 3 } } });
      await s.svc.getForPull('ws', 'pr1');
      await s.svc.getForPull('ws', 'pr1');
      expect(s.infos[0]!.obj).toMatchObject({ source: 'ripgrep_fallback', reparse: true, cached: false });
      expect(s.infos[1]!.obj).toMatchObject({ source: 'ripgrep_fallback', reparse: false, cached: true });
    });

    it('flag off counts as the fallback source', async () => {
      const s = setup({ parts: { enabled: false } });
      await s.svc.getForPull('ws', 'pr1');
      expect(s.infos[0]!.obj).toMatchObject({ source: 'ripgrep_fallback', reparse: true });
    });

    it('never logs a file path', async () => {
      const s = setup();
      await s.svc.getForPull('ws', 'pr1');
      for (const v of Object.values(s.infos[0]!.obj)) {
        if (typeof v === 'string') expect(v).not.toContain('/');
      }
    });
  });
});
