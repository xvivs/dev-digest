/**
 * Characterization (server spec 07, I1-I9): job handlers and the container
 * facades (`container.repoIntel`, `container.repoClone`) see the same per-repo
 * state, every job kind is registered once, test overrides of either facade do
 * not take the handlers with them, and the repos/resync routes keep their
 * response shapes. Real Postgres (Testcontainers); MockGitClient for git.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { JobRunner } from '../src/platform/jobs.js';
import type { ContainerOverrides } from '../src/platform/container.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder, MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import {
  INDEX_JOB_KIND,
  INDEXER_VERSION,
  REFRESH_JOB_KIND,
  RESYNC_JOB_KIND,
} from '../src/modules/repo-intel/constants.js';
import { CLONE_JOB_KIND } from '../src/modules/repos/constants.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import type { RepoCloneFacade } from '../src/modules/repos/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const HEAD = 'clone-head-1';
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** `entered` resolves when the call starts; the call returns once `release()` runs. */
function holder<R>(result: R) {
  const entered = deferred();
  const gate = deferred();
  const impl = async (): Promise<R> => {
    entered.resolve();
    await gate.promise;
    return result;
  };
  return { impl, entered: entered.promise, release: () => gate.resolve() };
}

/** blast-routes fake shape: the facade methods a route may call, nothing else. */
const fakeRepoIntel = () => {
  const requestIndex = vi.fn();
  const fake = {
    getIndexState: vi.fn(),
    getBlastRadius: vi.fn(),
    requestIndex,
  } as unknown as RepoIntel;
  return { fake, requestIndex };
};

d('one repo-intel / repos service per container (Testcontainers pg)', () => {
  let pg: PgFixture;
  let ws: string;
  let seq = 0;
  const apps: FastifyInstance[] = [];

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [w] = await pg.handle.db.select().from(t.workspaces);
    ws = w!.id;
  });
  afterEach(async () => {
    for (const app of apps.splice(0)) {
      await app.container.jobs.onIdle();
      await app.close();
    }
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function appWith(extra: ContainerOverrides = {}) {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ head: HEAD }),
        github: new MockGitHubClient(),
        ...extra,
      },
    });
    apps.push(app);
    return app;
  }

  /** A cloned repo with a full index at HEAD (so an incremental pass is a no-op). */
  async function fixture() {
    const n = ++seq;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: ws,
        owner: 'acme',
        name: `sg-${n}`,
        fullName: `acme/sg-${n}`,
        clonePath: `/nonexistent/clones/sg-${n}`,
      })
      .returning();
    await pg.handle.db.insert(t.repoIndexState).values({
      repoId: repo!.id,
      lastIndexedSha: HEAD,
      indexerVersion: INDEXER_VERSION,
      status: 'full',
      stats: {},
    });
    return { repoId: repo!.id, owner: 'acme', name: `sg-${n}` };
  }

  const jobRows = async (repoId: string, kind: string) =>
    pg.handle.db
      .select({ kind: t.jobs.kind, status: t.jobs.status, payload: t.jobs.payload })
      .from(t.jobs)
      .where(and(eq(t.jobs.kind, kind), sql`${t.jobs.payload}->>'repoId' = ${repoId}`));

  it('I1: the RESYNC handler and container.repoIntel share the index gate', async () => {
    const app = await appWith();
    const { repoId } = await fixture();
    const h = holder({ head: HEAD });
    vi.spyOn(app.container.git, 'sync').mockImplementationOnce(h.impl);
    // Test-only direct enqueue (bypasses the reservation): only the handler holds the key.
    await app.container.jobs.enqueue(ws, RESYNC_JOB_KIND, { repoId, workspaceId: ws });
    await h.entered;
    try {
      expect((await app.container.repoIntel.getIndexReadiness(repoId)).inFlight).toBe(true);
    } finally {
      h.release(); // a failed assertion must not leave the job hanging
    }
    await app.container.jobs.onIdle();
    expect((await app.container.repoIntel.getIndexReadiness(repoId)).inFlight).toBe(false);
  });

  it('I2: the clone handler and container.repoClone share the clone gate', async () => {
    const app = await appWith();
    const { repoId, owner, name } = await fixture();
    const h = holder({ path: `/mock/clones/${owner}/${name}` });
    vi.spyOn(app.container.git, 'clone').mockImplementationOnce(h.impl);
    await app.container.jobs.enqueue(ws, CLONE_JOB_KIND, {
      repoId,
      owner,
      name,
      url: `https://github.com/${owner}/${name}`,
    });
    await h.entered;
    try {
      expect((await app.container.repoClone.getCloneStatus(ws, repoId))?.inFlight).toBe(true);
    } finally {
      h.release();
    }
    await app.container.jobs.onIdle();
  });

  it('I3: a clone failure recorded by the handler is read by container.repoClone (AC-26)', async () => {
    const app = await appWith();
    const { repoId, owner, name } = await fixture();
    vi.spyOn(app.container.git, 'clone').mockRejectedValue(new Error('Repository not found'));
    await app.container.jobs.enqueue(ws, CLONE_JOB_KIND, {
      repoId,
      owner,
      name,
      url: `https://github.com/${owner}/${name}`,
    });
    await app.container.jobs.onIdle();
    const status = await app.container.repoClone.getCloneStatus(ws, repoId);
    expect(status?.lastFailure?.reason).toBe('not_found');
  });

  it('I4: clone, INDEX, REFRESH and RESYNC are each registered once on container.jobs', async () => {
    const register = vi.spyOn(JobRunner.prototype, 'register');
    const app = await appWith();
    const counts: Record<string, number> = {};
    register.mock.calls.forEach(([kind], i) => {
      if (register.mock.contexts[i] !== app.container.jobs) return;
      counts[kind] = (counts[kind] ?? 0) + 1;
    });
    expect(counts[CLONE_JOB_KIND]).toBe(1);
    expect(counts[INDEX_JOB_KIND]).toBe(1);
    expect(counts[REFRESH_JOB_KIND]).toBe(1);
    expect(counts[RESYNC_JOB_KIND]).toBe(1);
  });

  it('I5: with overrides.repoIntel, resync still goes through the real service and handler', async () => {
    const { fake, requestIndex } = fakeRepoIntel();
    const app = await appWith({ repoIntel: fake });
    const { repoId } = await fixture();
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/resync` });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body).toEqual({ status: 'accepted', jobId: expect.any(String) });
    await app.container.jobs.onIdle();
    expect(requestIndex).not.toHaveBeenCalled();
    expect(await jobRows(repoId, RESYNC_JOB_KIND)).toHaveLength(1);
  });

  it('I6: with overrides.repoClone, /repos routes use the real service; resync reads the stub', async () => {
    const stub = {
      getCloneStatus: vi.fn(async () => undefined),
      requestClone: vi.fn(),
    } as unknown as RepoCloneFacade;
    const app = await appWith({ repoClone: stub });
    const { repoId } = await fixture();
    const refresh = await app.inject({ method: 'POST', url: `/repos/${repoId}/refresh` });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json()).toEqual({ status: 'refreshing' });
    await app.container.jobs.onIdle();
    expect(await jobRows(repoId, CLONE_JOB_KIND)).toHaveLength(1);
    const resync = await app.inject({ method: 'POST', url: `/repos/${repoId}/resync` });
    expect(resync.statusCode).toBe(404);
  });

  /** Two concurrent resyncs while the first RESYNC body is held in `git.sync`. */
  async function concurrentResyncs(app: FastifyInstance, repoId: string) {
    const h = holder({ head: HEAD });
    const sync = vi.spyOn(app.container.git, 'sync').mockImplementationOnce(h.impl);
    const url = `/repos/${repoId}/resync`;
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url }),
      app.inject({ method: 'POST', url }),
    ]);
    await h.entered;
    h.release();
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    const bodies = [a.json(), b.json()];
    expect(bodies).toEqual(
      expect.arrayContaining([
        { status: 'accepted', jobId: expect.any(String) },
        { status: 'accepted', coalesced: true },
      ]),
    );
    await vi.waitFor(async () => {
      const rows = await jobRows(repoId, RESYNC_JOB_KIND);
      expect(rows).toHaveLength(2);
      for (const r of rows) expect((r.payload as { workspaceId?: string }).workspaceId).toBe(ws);
      expect(sync).toHaveBeenCalledTimes(2);
    });
  }

  it('I7: a coalesced resync is dispatched as its own RESYNC job on container.jobs', async () => {
    const app = await appWith();
    const { repoId } = await fixture();
    await concurrentResyncs(app, repoId);
    await vi.waitFor(async () =>
      expect((await app.container.repoIntel.getIndexReadiness(repoId)).inFlight).toBe(false),
    );
    await app.container.jobs.onIdle();
  });

  it('I8: with overrides.repoIntel, the trailing resync still runs and the real gate goes idle', async () => {
    const { fake, requestIndex } = fakeRepoIntel();
    const app = await appWith({ repoIntel: fake });
    const { repoId } = await fixture();
    await concurrentResyncs(app, repoId);
    await vi.waitFor(async () => {
      const rows = await jobRows(repoId, RESYNC_JOB_KIND);
      expect(rows.every((r) => r.status === 'done')).toBe(true);
    });
    await new Promise((r) => setTimeout(r, 0));
    // Exactly one probe, never retried: a coalesced retry would record another trailing pass.
    const third = await app.inject({ method: 'POST', url: `/repos/${repoId}/resync` });
    expect(third.statusCode).toBe(202);
    expect(third.json()).toEqual({ status: 'accepted', jobId: expect.any(String) });
    await app.container.jobs.onIdle();
    expect(requestIndex).not.toHaveBeenCalled();
  });

  it('I9: POST/GET/DELETE /repos keep their shapes', async () => {
    const app = await appWith();
    const n = ++seq;
    const url = `https://github.com/acme/sg-new-${n}`;
    const first = await app.inject({ method: 'POST', url: '/repos', payload: { url } });
    expect(first.statusCode).toBe(201);
    const id = (first.json() as { id: string }).id;
    const again = await app.inject({ method: 'POST', url: '/repos', payload: { url } });
    expect(again.statusCode).toBe(200);
    expect((again.json() as { id: string }).id).toBe(id);
    await app.container.jobs.onIdle();
    expect(await jobRows(id, CLONE_JOB_KIND)).toHaveLength(1);
    const list = await app.inject({ method: 'GET', url: '/repos' });
    expect(list.statusCode).toBe(200);
    expect((list.json() as Array<{ id: string }>).map((r) => r.id)).toContain(id);
    const del = await app.inject({ method: 'DELETE', url: `/repos/${id}` });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ deleted: id });
  });
});
