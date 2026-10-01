/**
 * Spec 06 D3/D4: the per-repo index gate wired into RepoIntelService —
 * `requestIndex` dedupes enqueues, the INDEX/REFRESH/RESYNC handlers never
 * overlap for one repo, and a JobRunner timeout does not free the repo while
 * the handler body still runs (AC-5, AC-6, AC-9, AC-10, AC-11).
 *
 * No DB: JobRunner runs over an in-memory fake, and the pipeline methods are
 * replaced by deferred stubs so overlap is observable.
 */
import { describe, it, expect, vi } from 'vitest';
import { JobRunner } from '../src/platform/jobs.js';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { INDEX_JOB_KIND, INDEXER_VERSION, REFRESH_JOB_KIND, RESYNC_JOB_KIND } from '../src/modules/repo-intel/constants.js';
import type { IndexResult, IndexState } from '../src/modules/repo-intel/types.js';
import type { Container } from '../src/platform/container.js';

function fakeDb(opts: { holdFirstDone?: Promise<void>; onDoneHeld?: () => void } = {}) {
  const inserted: string[] = [];
  const updates: Record<string, unknown>[] = [];
  let n = 0;
  let held = false;
  const db = {
    insert: () => ({
      values: (v: { kind: string }) => {
        inserted.push(v.kind);
        return { returning: async () => [{ id: `job-${++n}` }] };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updates.push(v);
        return {
          where: async () => {
            // Hold JobRunner between the handler's return and `done` (its 'done' row update).
            if (v.status === 'done' && opts.holdFirstDone && !held) {
              held = true;
              opts.onDoneHeld?.();
              await opts.holdFirstDone;
            }
          },
        };
      },
    }),
  };
  return { db, inserted, updates };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const OK: IndexResult = { status: 'full', filesIndexed: 1, filesSkipped: 0, durationMs: 1 };

function setup(
  opts: { timeoutMs?: number; register?: boolean; state?: IndexState | null; holdFirstDone?: Promise<void>; onDoneHeld?: () => void } = {},
) {
  const { db, inserted, updates } = fakeDb(opts);
  const jobs = new JobRunner(db as never, { retries: 0, timeoutMs: opts.timeoutMs ?? 5_000 });
  const warn = vi.fn();
  const container = {
    db,
    jobs,
    config: { repoIntelEnabled: true },
    logger: { debug() {}, info() {}, warn },
    git: { currentHead: async () => 'sha-head' },
  } as unknown as Container;

  const service = new RepoIntelService(container);
  (service as unknown as { repo: Record<string, unknown> }).repo = {
    getRepoBasics: async (id: string) => ({ id, owner: 'acme', name: 'app', defaultBranch: 'main', clonePath: '/clone' }),
    tryGetIndexState: async () => opts.state ?? null,
  };

  let active = 0;
  let maxActive = 0;
  const calls: string[] = [];
  const bodies: Array<ReturnType<typeof deferred>> = [];
  const track = (name: string) => async (): Promise<IndexResult> => {
    calls.push(name);
    active += 1;
    maxActive = Math.max(maxActive, active);
    const d = deferred();
    bodies.push(d);
    await d.promise;
    active -= 1;
    return OK;
  };
  service.indexRepo = vi.fn(track('index'));
  service.refreshIndex = vi.fn(track('refresh'));
  service.resyncRepo = vi.fn(track('resync'));
  if (opts.register !== false) service.registerIndexJobHandlers();

  /** Resolve the bodies started so far (not ones they trigger), then let microtasks run. */
  const releaseAll = async () => {
    for (const d of bodies.splice(0)) d.resolve();
    await new Promise((r) => setImmediate(r));
  };

  return { service, container, jobs, inserted, updates, warn, calls, releaseAll, maxActive: () => maxActive };
}

let seq = 0;
const freshRepo = () => `repo-${++seq}`;

describe('RepoIntelService.requestIndex', () => {
  it.each([
    ['index', INDEX_JOB_KIND],
    ['refresh', REFRESH_JOB_KIND],
    ['resync', RESYNC_JOB_KIND],
  ] as const)('idle → enqueues one %s job', async (kind, jobKind) => {
    const s = setup();
    const res = await s.service.requestIndex('w1', freshRepo(), kind);
    expect(res).toMatchObject({ queued: true });
    expect(res.jobId).toBeDefined();
    expect(s.inserted).toEqual([jobKind]);
    await s.releaseAll();
    await s.jobs.onIdle();
  });

  it('busy → in_flight and no insert; two calls in one tick enqueue once', async () => {
    const s = setup();
    const repoId = freshRepo();
    const [a, b] = await Promise.all([
      s.service.requestIndex('w1', repoId, 'index'),
      s.service.requestIndex('w1', repoId, 'refresh'),
    ]);
    expect(a.queued).toBe(true);
    expect(b).toEqual({ queued: false, reason: 'in_flight' });
    expect(s.inserted).toEqual([INDEX_JOB_KIND]);

    // The refused request became one trailing incremental after the full body.
    await vi.waitFor(() => expect(s.calls).toEqual(['index']));
    await s.releaseAll();
    await vi.waitFor(() => expect(s.calls).toEqual(['index', 'refresh']));
    await s.releaseAll();
    await s.jobs.onIdle();
    expect((await s.service.getIndexReadiness(repoId)).inFlight).toBe(false);
  });

  it('no handler registered → no_handler, reservation released', async () => {
    const s = setup({ register: false });
    const repoId = freshRepo();
    await expect(s.service.requestIndex('w1', repoId, 'index')).resolves.toEqual({
      queued: false,
      reason: 'no_handler',
    });
    expect((await s.service.getIndexReadiness(repoId)).inFlight).toBe(false);
  });
});

describe('index job handlers under the gate', () => {
  it('INDEX + REFRESH handlers started together → one body at a time, the second becomes a trailing incremental', async () => {
    const s = setup();
    const repoId = freshRepo();
    // Enqueue both directly (as two overlapping jobs would land after a timeout),
    // with the payload `requestIndex` writes.
    await s.jobs.enqueue('w1', INDEX_JOB_KIND, { repoId, workspaceId: 'w1' });
    await s.jobs.enqueue('w1', REFRESH_JOB_KIND, { repoId, workspaceId: 'w1' });
    await vi.waitFor(() => expect(s.calls).toEqual(['index']));
    // The REFRESH job finished without running its body.
    await vi.waitFor(() => expect(s.updates.filter((u) => u.status === 'done')).toHaveLength(1));
    expect(s.calls).toEqual(['index']);

    await s.releaseAll();
    await vi.waitFor(() => expect(s.calls).toEqual(['index', 'refresh']));
    await s.releaseAll();
    await s.jobs.onIdle();
    expect(s.maxActive()).toBe(1);
    expect(s.calls).toEqual(['index', 'refresh']);
  });

  it('a contended RESYNC wins over REFRESH in the trailing pass', async () => {
    const s = setup();
    const repoId = freshRepo();
    await s.jobs.enqueue('w1', INDEX_JOB_KIND, { repoId, workspaceId: 'w1' });
    await vi.waitFor(() => expect(s.calls).toEqual(['index']));
    await s.jobs.enqueue('w1', REFRESH_JOB_KIND, { repoId, workspaceId: 'w1' });
    await s.jobs.enqueue('w1', RESYNC_JOB_KIND, { repoId, workspaceId: 'w1' });
    await vi.waitFor(() => expect(s.updates.filter((u) => u.status === 'done')).toHaveLength(2));
    await s.releaseAll();
    await vi.waitFor(() => expect(s.calls).toEqual(['index', 'resync']));
    await s.releaseAll();
    await s.jobs.onIdle();
    expect(s.maxActive()).toBe(1);
  });

  it('timeout settles done early; the repo stays busy until the body returns, then the trailing pass runs', async () => {
    const s = setup({ timeoutMs: 20 });
    const repoId = freshRepo();
    await s.service.requestIndex('w1', repoId, 'index');
    await vi.waitFor(() => expect(s.calls).toEqual(['index']));
    // JobRunner timed the job out and recorded it as failed…
    await vi.waitFor(() => expect(s.updates.some((u) => u.status === 'failed')).toBe(true));
    // …but the handler body is still running, so the gate holds.
    expect((await s.service.getIndexReadiness(repoId)).inFlight).toBe(true);
    await expect(s.service.requestIndex('w1', repoId, 'refresh')).resolves.toEqual({
      queued: false,
      reason: 'in_flight',
    });

    await s.releaseAll();
    await vi.waitFor(() => expect(s.calls).toEqual(['index', 'refresh']));
    expect((await s.service.getIndexReadiness(repoId)).inFlight).toBe(true);
    await s.releaseAll();
    await vi.waitFor(async () => expect((await s.service.getIndexReadiness(repoId)).inFlight).toBe(false));
  });
});

describe('trailing passes (code-review F1, F3, F4)', () => {
  it('F1: a request between the body end and `done` is not dropped', async () => {
    const done = deferred();
    const doneHeld = deferred();
    const s = setup({ holdFirstDone: done.promise, onDoneHeld: doneHeld.resolve });
    const repoId = freshRepo();
    await s.service.requestIndex('w1', repoId, 'refresh');
    await vi.waitFor(() => expect(s.calls).toEqual(['refresh']));
    await s.releaseAll();
    // The body returned; JobRunner is still writing the 'done' row, so `done` is pending.
    await doneHeld.promise;
    expect((await s.service.getIndexReadiness(repoId)).inFlight).toBe(true);
    await expect(s.service.requestIndex('w1', repoId, 'resync')).resolves.toEqual({ queued: false, reason: 'in_flight' });
    done.resolve();
    await vi.waitFor(() => expect(s.calls).toEqual(['refresh', 'resync']));
    await s.releaseAll();
    await s.jobs.onIdle();
    expect(s.warn).not.toHaveBeenCalled();
  });

  it('F3: a coalesced full-index request stays a full index', async () => {
    const s = setup();
    const repoId = freshRepo();
    await s.service.requestIndex('w1', repoId, 'refresh');
    await vi.waitFor(() => expect(s.calls).toEqual(['refresh']));
    await expect(s.service.requestIndex('w1', repoId, 'index')).resolves.toMatchObject({ reason: 'in_flight' });
    await s.releaseAll();
    await vi.waitFor(() => expect(s.calls).toEqual(['refresh', 'index']));
    await s.releaseAll();
    await s.jobs.onIdle();
  });

  it('F3: coalesced index + resync → one resync pass that ends in a full index', async () => {
    const s = setup();
    const repoId = freshRepo();
    await s.service.requestIndex('w1', repoId, 'refresh');
    await vi.waitFor(() => expect(s.calls).toEqual(['refresh']));
    await s.service.requestIndex('w1', repoId, 'index');
    await s.service.requestIndex('w1', repoId, 'resync');
    await s.service.requestIndex('w1', repoId, 'refresh');
    await s.releaseAll();
    await vi.waitFor(() => expect(s.calls).toEqual(['refresh', 'resync']));
    expect(s.service.resyncRepo).toHaveBeenLastCalledWith(repoId, { full: true });
    await s.releaseAll();
    await s.jobs.onIdle();
    expect(s.maxActive()).toBe(1);
  });

  it('F4: a trailing pass runs as its own job, after the first job settled', async () => {
    const s = setup();
    const repoId = freshRepo();
    await s.service.requestIndex('w1', repoId, 'index');
    await vi.waitFor(() => expect(s.calls).toEqual(['index']));
    await s.service.requestIndex('w1', repoId, 'refresh');
    await s.releaseAll();
    await vi.waitFor(() => expect(s.calls).toEqual(['index', 'refresh']));
    // Its own jobs row (own 120 s budget); the first job is already `done`.
    expect(s.inserted).toEqual([INDEX_JOB_KIND, REFRESH_JOB_KIND]);
    expect(s.updates.filter((u) => u.status === 'done')).toHaveLength(1);
    expect((await s.service.getIndexReadiness(repoId)).inFlight).toBe(true);
    await s.releaseAll();
    await s.jobs.onIdle();
    await vi.waitFor(async () => expect((await s.service.getIndexReadiness(repoId)).inFlight).toBe(false));
    expect(s.maxActive()).toBe(1);
  });
});

describe('index job handler without a workspace in its payload', () => {
  it('a contended pass that cannot be re-enqueued is dropped with a warn and frees the repo', async () => {
    const s = setup();
    const repoId = freshRepo();
    await s.jobs.enqueue('w1', INDEX_JOB_KIND, { repoId });
    await vi.waitFor(() => expect(s.calls).toEqual(['index']));
    await s.jobs.enqueue('w1', REFRESH_JOB_KIND, { repoId });
    await vi.waitFor(() => expect(s.updates.filter((u) => u.status === 'done')).toHaveLength(1));
    await s.releaseAll();
    await s.jobs.onIdle();
    await vi.waitFor(() =>
      expect(s.warn).toHaveBeenCalledWith(expect.objectContaining({ repoId }), 'index gate: trailing pass not enqueued'),
    );
    expect(s.calls).toEqual(['index']);
    expect((await s.service.getIndexReadiness(repoId)).inFlight).toBe(false);
  });
});

describe('index job handler failure', () => {
  it('a body that throws frees the repo: readiness idle, the next request queues a job', async () => {
    const s = setup();
    const repoId = freshRepo();
    s.service.indexRepo = vi.fn(async () => {
      throw new Error('graph exploded');
    });
    await expect(s.service.requestIndex('w1', repoId, 'index')).resolves.toMatchObject({ queued: true });
    await s.jobs.onIdle();
    await vi.waitFor(() => expect(s.updates.some((u) => u.status === 'failed')).toBe(true));
    await vi.waitFor(async () => expect((await s.service.getIndexReadiness(repoId)).inFlight).toBe(false));
    // Not looped: exactly one job ran, and a manual retry is accepted.
    expect(s.inserted).toEqual([INDEX_JOB_KIND]);
    await expect(s.service.requestIndex('w1', repoId, 'index')).resolves.toMatchObject({ queued: true });
    await s.jobs.onIdle();
  });

  it('a timeout followed by a throwing body still frees the repo', async () => {
    const s = setup({ timeoutMs: 20 });
    const repoId = freshRepo();
    const fail = deferred();
    s.service.indexRepo = vi.fn(async () => {
      await fail.promise;
      throw new Error('late failure');
    });
    await s.service.requestIndex('w1', repoId, 'index');
    await vi.waitFor(() => expect(s.updates.some((u) => u.status === 'failed')).toBe(true));
    expect((await s.service.getIndexReadiness(repoId)).inFlight).toBe(true);
    fail.resolve();
    await vi.waitFor(async () => expect((await s.service.getIndexReadiness(repoId)).inFlight).toBe(false));
  });
});

describe('RepoIntelService.getIndexReadiness', () => {
  it('reports the clone HEAD, the persisted row and the version check', async () => {
    const state: IndexState = {
      repoId: 'r',
      status: 'full',
      filesIndexed: 1,
      filesSkipped: 0,
      durationMs: 1,
      lastIndexedSha: 'sha-head',
      indexerVersion: INDEXER_VERSION,
      updatedAt: new Date(0),
      lastIndexedAt: null,
    };
    const s = setup({ state });
    await expect(s.service.getIndexReadiness(freshRepo())).resolves.toEqual({
      enabled: true,
      cloneHead: 'sha-head',
      state,
      versionCurrent: true,
      inFlight: false,
    });
  });
});
