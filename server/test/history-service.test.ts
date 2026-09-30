/** Hermetic: every port is an in-memory fake. */
import { describe, it, expect } from 'vitest';
import { ConfigError } from '../src/platform/errors.js';
import { sha256Hex } from '../src/modules/_shared/hash.js';
import { HISTORY_PER_PATH, HISTORY_TTL_MS } from '../src/modules/history/constants.js';
import type { PathHistoryInput } from '../src/modules/history/domain.js';
import type { HistoryCacheEntry, HistoryPull, HistoryStore } from '../src/modules/history/ports.js';
import { HistoryService } from '../src/modules/history/service.js';

const PULL: HistoryPull = { id: 'pr1', repoId: 'r1', number: 10, headSha: 'h1', base: 'main' };
const T0 = Date.parse('2026-06-01T00:00:00Z');

const row = (number: number, path: string, mergedAt: string | null = '2026-05-01T00:00:00Z'): PathHistoryInput => ({
  path,
  number,
  title: `PR ${number}`,
  author: 'sam',
  mergedAt,
});

function setup(opts: {
  files?: { path: string; additions: number; deletions: number }[];
  list?: (paths: string[]) => Promise<PathHistoryInput[]>;
  repo?: boolean;
  pull?: HistoryPull;
} = {}) {
  const rows = new Map<string, HistoryCacheEntry>();
  const calls: { repo: unknown; ref: string; paths: string[]; perPath: number }[] = [];
  const warns: unknown[] = [];
  let nowMs = T0;
  const store: HistoryStore = {
    get: async (id) => rows.get(id),
    upsert: async (id, e) => {
      rows.set(id, { ...e, computedAt: new Date(nowMs) });
    },
  };
  const svc = new HistoryService({
    store,
    pulls: {
      getPull: async (_ws, id) => (id === 'pr1' ? (opts.pull ?? PULL) : undefined),
      getRepo: async () => (opts.repo === false ? undefined : { owner: 'acme', name: 'api' }),
      getPrFiles: async () => opts.files ?? [{ path: 'a.ts', additions: 3, deletions: 1 }, { path: 'b.ts', additions: 1, deletions: 0 }],
    },
    github: {
      list: async (repo, ref, paths, perPath) => {
        calls.push({ repo, ref, paths, perPath });
        return opts.list ? opts.list(paths) : [row(5, 'a.ts'), row(5, 'b.ts'), row(6, 'a.ts')];
      },
    },
    log: { debug() {}, warn: (o) => warns.push(o) },
    now: () => nowMs,
  });
  return { svc, rows, calls, warns, advance: (ms: number) => (nowMs += ms) };
}

describe('HistoryService.getForPull', () => {
  it('404 path: a PR outside the workspace is undefined and GitHub is not called', async () => {
    const s = setup();
    expect(await s.svc.getForPull('ws', 'other')).toBeUndefined();
    expect(s.calls).toHaveLength(0);
  });

  it('no changed files -> unavailable/no_changed_files without a GitHub call', async () => {
    const s = setup({ files: [] });
    expect(await s.svc.getForPull('ws', 'pr1')).toMatchObject({ status: 'unavailable', reason: 'no_changed_files', history: [], cached: false });
    expect(s.calls).toHaveLength(0);
  });

  it('miss: queries the base ref with churn-ordered paths, stores and returns the history', async () => {
    const s = setup();
    const v = await s.svc.getForPull('ws', 'pr1');
    expect(s.calls).toEqual([{ repo: { owner: 'acme', name: 'api' }, ref: 'main', paths: ['a.ts', 'b.ts'], perPath: HISTORY_PER_PATH }]);
    expect(v).toMatchObject({ status: 'ok', reason: null, cached: false, queriedPaths: ['a.ts', 'b.ts'] });
    expect(v!.history.map((i) => i.pr_number)).toEqual([6, 5]); // equal merge dates: higher number first
    expect(s.rows.get('pr1')!.pathsHash).toBe(sha256Hex('a.ts\nb.ts'));
  });

  it('fresh cache (<6 h, same key) makes no GitHub call and reports cached', async () => {
    const s = setup();
    await s.svc.getForPull('ws', 'pr1');
    s.advance(HISTORY_TTL_MS - 1000);
    const v = await s.svc.getForPull('ws', 'pr1');
    expect(v).toMatchObject({ status: 'ok', cached: true });
    expect(v!.history.length).toBeGreaterThan(0);
    expect(s.calls).toHaveLength(1);
  });

  it('TTL expired -> refetch', async () => {
    const s = setup();
    await s.svc.getForPull('ws', 'pr1');
    s.advance(HISTORY_TTL_MS + 1);
    expect((await s.svc.getForPull('ws', 'pr1'))!.cached).toBe(false);
    expect(s.calls).toHaveLength(2);
  });

  it('a changed file set (different paths hash) refetches inside the TTL', async () => {
    const s = setup();
    await s.svc.getForPull('ws', 'pr1');
    const s2 = setup({ files: [{ path: 'other.ts', additions: 1, deletions: 0 }] });
    // reuse the cached row from the first service
    s2.rows.set('pr1', s.rows.get('pr1')!);
    expect((await s2.svc.getForPull('ws', 'pr1'))!.cached).toBe(false);
    expect(s2.calls).toHaveLength(1);
  });

  it('a moved head or base refetches inside the TTL', async () => {
    for (const change of [{ headSha: 'h2' }, { base: 'develop' }]) {
      const a = setup();
      await a.svc.getForPull('ws', 'pr1');
      const b = setup({ pull: { ...PULL, ...change } });
      b.rows.set('pr1', a.rows.get('pr1')!);
      expect((await b.svc.getForPull('ws', 'pr1'))!.cached).toBe(false);
      expect(b.calls).toHaveLength(1);
    }
  });

  it('ConfigError -> unavailable/no_github, not cached', async () => {
    const s = setup({ list: async () => Promise.reject(new ConfigError('no token')) });
    expect(await s.svc.getForPull('ws', 'pr1')).toMatchObject({ status: 'unavailable', reason: 'no_github', history: [], queriedPaths: ['a.ts', 'b.ts'] });
    expect(s.rows.size).toBe(0);
  });

  it('any other fetch error -> unavailable/fetch_failed, warned, not cached (next read retries)', async () => {
    let fail = true;
    const s = setup({ list: async () => (fail ? Promise.reject(new Error('graphql 502')) : [row(5, 'a.ts')]) });
    expect(await s.svc.getForPull('ws', 'pr1')).toMatchObject({ status: 'unavailable', reason: 'fetch_failed' });
    expect(s.rows.size).toBe(0);
    expect(s.warns).toHaveLength(1);
    fail = false;
    expect(await s.svc.getForPull('ws', 'pr1')).toMatchObject({ status: 'ok', cached: false });
  });

  it('filters the PR itself and unmerged rows out of what it returns', async () => {
    const s = setup({ list: async () => [row(10, 'a.ts'), row(3, 'a.ts', null), row(2, 'a.ts')] });
    const v = await s.svc.getForPull('ws', 'pr1');
    expect(v!.history.map((i) => i.pr_number)).toEqual([2]);
  });

  it('a missing repo is treated as not found', async () => {
    expect(await setup({ repo: false }).svc.getForPull('ws', 'pr1')).toBeUndefined();
  });
});
