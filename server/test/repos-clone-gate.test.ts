/**
 * Spec 06 D4/D5: the clone gate behind `container.repoClone` and the clone
 * job's gated index follow-up (AC-4, AC-8, AC-19).
 *
 * No DB: JobRunner over an in-memory fake, a RepoRepository stub, and a
 * `repoIntel.requestIndex` spy.
 */
import { describe, it, expect, vi } from 'vitest';
import { JobRunner } from '../src/platform/jobs.js';
import { RepoService } from '../src/modules/repos/service.js';
import { CLONE_JOB_KIND } from '../src/modules/repos/constants.js';
import type { RepoRepository, RepoRow } from '../src/modules/repos/repository.js';
import type { Container } from '../src/platform/container.js';

function fakeDb() {
  const inserted: string[] = [];
  let n = 0;
  const db = {
    insert: () => ({
      values: (v: { kind: string }) => {
        inserted.push(v.kind);
        return { returning: async () => [{ id: `job-${++n}` }] };
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  return { db, inserted };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

let seq = 0;

function setup(opts: { clonePath?: string | null; holdClone?: boolean; failClone?: boolean | string; timeoutMs?: number } = {}) {
  const repoId = `repo-${++seq}`;
  const row: RepoRow = {
    id: repoId,
    workspaceId: 'w1',
    owner: 'acme',
    name: 'app',
    fullName: 'acme/app',
    defaultBranch: 'main',
    clonePath: opts.clonePath ?? null,
    lastPolledAt: null,
    createdBy: 'u1',
  } as RepoRow;

  const { db, inserted } = fakeDb();
  const jobs = new JobRunner(db as never, { retries: 0, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
  const hold = deferred();
  const cloneStarted = deferred();
  const git = {
    clone: vi.fn(async () => {
      cloneStarted.resolve();
      if (opts.failClone) throw new Error(typeof opts.failClone === 'string' ? opts.failClone : 'repository not found');
      if (opts.holdClone) await hold.promise;
      return { path: '/clones/acme/app' };
    }),
  };
  let service!: RepoService;
  const inFlightAtRequest: boolean[] = [];
  const requestIndex = vi.fn(async (ws: string, id: string, _kind: string) => {
    inFlightAtRequest.push((await service.getCloneStatus(ws, id))!.inFlight);
    return { queued: true };
  });
  const container = {
    db,
    jobs,
    git,
    secrets: { get: async () => undefined },
    repoIntel: { requestIndex },
  } as unknown as Container;

  const repo = {
    getById: async (ws: string, id: string) => (ws === 'w1' && id === repoId ? row : undefined),
    getCloneBasics: async (id: string) => (id === repoId ? { workspaceId: 'w1', clonePath: row.clonePath } : undefined),
    updateClonePath: async (_id: string, path: string) => {
      row.clonePath = path;
    },
  } as unknown as RepoRepository;

  service = new RepoService(container, repo);
  service.registerCloneJobHandler();
  return { service, jobs, inserted, git, requestIndex, inFlightAtRequest, repoId, hold, cloneStarted, row };
}

describe('RepoService clone gate', () => {
  it('requestClone twice → one clone job', async () => {
    const s = setup({ holdClone: true });
    const [a, b] = await Promise.all([
      s.service.requestClone('w1', s.repoId),
      s.service.requestClone('w1', s.repoId),
    ]);
    expect(a).toEqual({ queued: true });
    expect(b).toEqual({ queued: false, reason: 'in_flight' });
    expect(s.inserted).toEqual([CLONE_JOB_KIND]);
    expect((await s.service.getCloneStatus('w1', s.repoId))!.inFlight).toBe(true);
    s.hold.resolve();
    await s.jobs.onIdle();
    await new Promise((r) => setImmediate(r));
    expect(await s.service.getCloneStatus('w1', s.repoId)).toEqual({ cloned: true, inFlight: false, lastFailure: null });
  });

  it("a fresh clone requests a full index, before the clone gate frees", async () => {
    const s = setup({ clonePath: null });
    await s.service.requestClone('w1', s.repoId);
    await s.jobs.onIdle();
    expect(s.requestIndex).toHaveBeenCalledWith('w1', s.repoId, 'index');
    expect(s.inFlightAtRequest).toEqual([true]);
  });

  it("an existing clone requests an incremental refresh", async () => {
    const s = setup({ clonePath: '/clones/acme/app' });
    await s.service.requestClone('w1', s.repoId);
    await s.jobs.onIdle();
    expect(s.requestIndex).toHaveBeenCalledWith('w1', s.repoId, 'refresh');
    expect(s.requestIndex).not.toHaveBeenCalledWith('w1', s.repoId, 'index');
    expect(s.inFlightAtRequest).toEqual([true]);
  });

  it('refresh while a clone is in flight → no second clone job; the running clone\'s follow-up requests the refresh index', async () => {
    const s = setup({ clonePath: '/clones/acme/app', holdClone: true });
    await s.service.requestClone('w1', s.repoId);
    await s.cloneStarted.promise;
    await expect(s.service.refresh('w1', s.repoId)).resolves.toEqual({ status: 'refreshing' });
    expect(s.inserted).toEqual([CLONE_JOB_KIND]);
    expect(s.requestIndex).not.toHaveBeenCalled();
    s.hold.resolve();
    await s.jobs.onIdle();
    expect(s.git.clone).toHaveBeenCalledTimes(1);
    expect(s.requestIndex).toHaveBeenCalledTimes(1);
    expect(s.requestIndex).toHaveBeenCalledWith('w1', s.repoId, 'refresh');
  });

  it('F6: Refresh repo on an existing clone requests the index once (the clone follow-up)', async () => {
    const s = setup({ clonePath: '/clones/acme/app' });
    await expect(s.service.refresh('w1', s.repoId)).resolves.toEqual({ status: 'refreshing' });
    await s.jobs.onIdle();
    expect(s.requestIndex).toHaveBeenCalledTimes(1);
    expect(s.requestIndex).toHaveBeenCalledWith('w1', s.repoId, 'refresh');
  });

  it('a contended clone handler returns without cloning', async () => {
    const s = setup({ holdClone: true });
    // Two clone jobs enqueued directly (bypassing the request-time reservation).
    await s.jobs.enqueue('w1', CLONE_JOB_KIND, { repoId: s.repoId, owner: 'acme', name: 'app', url: 'u' });
    await s.cloneStarted.promise;
    const second = await s.jobs.enqueue('w1', CLONE_JOB_KIND, { repoId: s.repoId, owner: 'acme', name: 'app', url: 'u' });
    await second.done;
    expect(s.git.clone).toHaveBeenCalledTimes(1);
    s.hold.resolve();
    await s.jobs.onIdle();
  });

  it('a failed clone (repo does not exist) requests no index, frees the gate and does not re-enqueue itself', async () => {
    const s = setup({ clonePath: null, failClone: true });
    await expect(s.service.requestClone('w1', s.repoId)).resolves.toEqual({ queued: true });
    await s.jobs.onIdle();
    await new Promise((r) => setImmediate(r));
    expect(s.git.clone).toHaveBeenCalledTimes(1);
    expect(s.requestIndex).not.toHaveBeenCalled();
    expect(s.row.clonePath).toBeNull();
    // Idle and still uncloned: readiness will offer `clone` again, but only on a new request.
    expect(await s.service.getCloneStatus('w1', s.repoId)).toMatchObject({ cloned: false, inFlight: false, lastFailure: { reason: 'not_found' } });
    expect(s.inserted).toEqual([CLONE_JOB_KIND]);
    // A manual retry is accepted (the reservation was released on failure).
    await expect(s.service.requestClone('w1', s.repoId)).resolves.toEqual({ queued: true });
    await s.jobs.onIdle();
    expect(s.inserted).toEqual([CLONE_JOB_KIND, CLONE_JOB_KIND]);
  });

  it('a failed clone records only a safe class; a retry that starts clears it, a success keeps it clear', async () => {
    const leaky =
      "fatal: unable to access 'https://x-access-token:ghp_SECRET@github.com/acme/app.git/': Could not resolve host: github.com";
    const s = setup({ clonePath: null, failClone: leaky });
    await s.service.requestClone('w1', s.repoId);
    await s.jobs.onIdle();
    await new Promise((r) => setImmediate(r));
    const failed = (await s.service.getCloneStatus('w1', s.repoId))!;
    expect(failed.lastFailure?.reason).toBe('network');
    expect(failed.lastFailure?.at).toBeInstanceOf(Date);
    expect(JSON.stringify(failed)).not.toMatch(/ghp_SECRET|github\.com|x-access-token/);

    s.git.clone.mockResolvedValueOnce({ path: '/clones/acme/app' });
    await s.service.requestClone('w1', s.repoId);
    await s.jobs.onIdle();
    await new Promise((r) => setImmediate(r));
    expect(await s.service.getCloneStatus('w1', s.repoId)).toEqual({ cloned: true, inFlight: false, lastFailure: null });
  });

  it('a new attempt clears the old failure while it is still running', async () => {
    const s = setup({ clonePath: null, failClone: true });
    await s.service.requestClone('w1', s.repoId);
    await s.jobs.onIdle();
    await new Promise((r) => setImmediate(r));
    expect((await s.service.getCloneStatus('w1', s.repoId))!.lastFailure).not.toBeNull();

    s.git.clone.mockImplementationOnce(async () => {
      await s.hold.promise;
      return { path: '/clones/acme/app' };
    });
    await s.service.requestClone('w1', s.repoId);
    await vi.waitFor(async () => expect((await s.service.getCloneStatus('w1', s.repoId))!.lastFailure).toBeNull());
    s.hold.resolve();
    await s.jobs.onIdle();
  });

  it('JobRunner timeout settles done early; the clone stays in flight until the handler returns, then the follow-up runs', async () => {
    const s = setup({ clonePath: null, holdClone: true, timeoutMs: 20 });
    const enqueue = vi.spyOn(s.jobs, 'enqueue');
    await s.service.requestClone('w1', s.repoId);
    await s.cloneStarted.promise;
    const job = await enqueue.mock.results[0]!.value;
    await expect(job.done).rejects.toThrow(/timed out/i);
    expect((await s.service.getCloneStatus('w1', s.repoId))!.inFlight).toBe(true);
    await expect(s.service.requestClone('w1', s.repoId)).resolves.toEqual({ queued: false, reason: 'in_flight' });
    expect(s.git.clone).toHaveBeenCalledTimes(1);
    s.hold.resolve();
    await vi.waitFor(() => expect(s.requestIndex).toHaveBeenCalledWith('w1', s.repoId, 'index'));
    await vi.waitFor(async () => expect((await s.service.getCloneStatus('w1', s.repoId))!.inFlight).toBe(false));
  });

  it('foreign repo → undefined, no job', async () => {
    const s = setup();
    await expect(s.service.getCloneStatus('w2', s.repoId)).resolves.toBeUndefined();
    await expect(s.service.requestClone('w2', s.repoId)).resolves.toBeUndefined();
    expect(s.inserted).toEqual([]);
  });

  it('no clone handler → no_handler, reservation released', async () => {
    const bare = new RepoService(
      { db: fakeDb().db, jobs: new JobRunner(fakeDb().db as never), secrets: {}, git: {} } as unknown as Container,
      { getById: async () => ({ id: 'x', owner: 'acme', name: 'app', fullName: 'acme/app', clonePath: null }) } as unknown as RepoRepository,
    );
    await expect(bare.requestClone('w1', 'x')).resolves.toEqual({ queued: false, reason: 'no_handler' });
    await expect(bare.getCloneStatus('w1', 'x')).resolves.toEqual({ cloned: false, inFlight: false, lastFailure: null });
  });
});
