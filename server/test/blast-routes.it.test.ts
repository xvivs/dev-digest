/**
 * GET /pulls/:id/blast end to end over a real Postgres (Testcontainers):
 * buildApp + inject, the real BlastRepository and cache table, a scripted
 * `repoIntel` (counts facade calls) and MockGitClient for the clone head.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder, MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import type { BlastResult, IndexState, RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = (env: Record<string, string> = {}) =>
  loadConfig({ ...process.env, NODE_ENV: 'test', ...env } as NodeJS.ProcessEnv);

function fakeRepoIntel() {
  const state = {
    index: {
      repoId: 'x',
      status: 'full',
      filesIndexed: 1,
      filesSkipped: 0,
      durationMs: 1,
      lastIndexedSha: 'idx1',
      indexerVersion: 3,
      updatedAt: new Date(),
    } as IndexState,
    blast: {
      changedSymbols: [{ file: 'src/a.ts', name: 'limit', kind: 'function' }],
      callers: [{ file: 'src/routes.ts', symbol: 'handler', viaSymbol: 'limit', line: 12, rank: 1 }],
      impactedEndpoints: ['GET /x'],
      factsByFile: { 'src/routes.ts': { endpoints: ['GET /x'], crons: [] } },
    } as BlastResult,
    blastCalls: [] as { repoId: string; files: string[] }[],
  };
  const repoIntel = {
    getIndexState: async () => state.index,
    getBlastRadius: async (repoId: string, files: string[]) => {
      state.blastCalls.push({ repoId, files });
      return state.blast;
    },
  } as unknown as RepoIntel;
  return { repoIntel, state };
}

d('GET /pulls/:id/blast (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'blast-it', fullName: 'acme/blast-it' })
      .returning();
    repoId = repo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function appWith(env: Record<string, string> = {}) {
    const fake = fakeRepoIntel();
    const app = await buildApp({
      config: config(env),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ head: 'clone-head-1' }),
        github: new MockGitHubClient(),
        repoIntel: fake.repoIntel,
      },
    });
    return { app, ...fake };
  }

  async function makePr(opts: { files?: string[]; workspace?: string; repo?: string } = {}) {
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: opts.workspace ?? workspaceId,
        repoId: opts.repo ?? repoId,
        number: 7000 + ++seq,
        title: 'Blast PR',
        author: 'sam',
        branch: 'feat',
        base: 'main',
        headSha: 'head-1',
      })
      .returning();
    const files = opts.files ?? ['src/a.ts'];
    if (files.length > 0) {
      await pg.handle.db.insert(t.prFiles).values(files.map((path) => ({ prId: pr!.id, path, additions: 1, deletions: 0 })));
    }
    return pr!;
  }

  const cacheRows = (prId: string) =>
    pg.handle.db.select().from(t.prBlastCache).where(eq(t.prBlastCache.prId, prId));

  it('computes ok from a full index, returns the snake_case DTO and persists the cache row', async () => {
    const { app, state } = await appWith();
    const pr = await makePr();
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      status: 'ok',
      reason: null,
      head_sha: 'head-1',
      source_sha: 'idx1',
      index_status: 'full',
      cached: false,
      truncated: false,
    });
    expect(Number.isNaN(Date.parse(body.computed_at))).toBe(false);
    expect(body.blast.changed_symbols).toEqual([{ name: 'limit', file: 'src/a.ts', kind: 'function' }]);
    expect(body.blast.downstream[0]).toMatchObject({ symbol: 'limit', endpoints_affected: ['GET /x'], crons_affected: [] });
    expect(state.blastCalls).toEqual([{ repoId, files: ['src/a.ts'] }]);
    const rows = await cacheRows(pr.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'ok', sourceSha: 'idx1', indexerVersion: 3, repoIntelEnabled: true });
    await app.close();
  });

  it('a second GET is a cache hit: cached=true and the facade is not called again', async () => {
    const { app, state } = await appWith();
    const pr = await makePr();
    await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    const again = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ status: 'ok', cached: true });
    expect(state.blastCalls).toHaveLength(1);
    await app.close();
  });

  it('a changed key (index sha, then the head) recomputes and overwrites the single cache row', async () => {
    const { app, state } = await appWith();
    const pr = await makePr();
    await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });

    state.index = { ...state.index, lastIndexedSha: 'idx2' };
    const second = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(second.json()).toMatchObject({ cached: false, source_sha: 'idx2' });
    expect(state.blastCalls).toHaveLength(2);

    await pg.handle.db.update(t.pullRequests).set({ headSha: 'head-2' }).where(eq(t.pullRequests.id, pr.id));
    const third = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(third.json()).toMatchObject({ cached: false, head_sha: 'head-2' });
    expect(state.blastCalls).toHaveLength(3);
    expect(await cacheRows(pr.id)).toHaveLength(1);
    await app.close();
  });

  it('REPO_INTEL_ENABLED=false degrades with flag_off and the flag is part of the key', async () => {
    const off = await appWith({ REPO_INTEL_ENABLED: 'false' });
    const pr = await makePr();
    const res = await off.app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.json()).toMatchObject({ status: 'degraded', reason: 'flag_off' });
    await off.app.close();

    // Same PR, flag now on: the cached flag_off row must not be served.
    const on = await appWith();
    const res2 = await on.app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res2.json()).toMatchObject({ status: 'ok', cached: false });
    await on.app.close();
  });

  it('a ripgrep-fallback result on a full index is degraded/no_index, and keeps the truncation flag', async () => {
    const { app, state } = await appWith();
    state.blast = { ...state.blast, degraded: true, truncated: true, factsByFile: undefined };
    const pr = await makePr();
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.json()).toMatchObject({ status: 'degraded', reason: 'no_index', truncated: true });
    expect(res.json().blast.downstream[0]).toMatchObject({ endpoints_affected: [], crons_affected: [] });
    await app.close();
  });

  it('no index: source_sha falls back to the clone head', async () => {
    const { app, state } = await appWith();
    state.index = { ...state.index, status: 'failed', lastIndexedSha: '' };
    const pr = await makePr();
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.json()).toMatchObject({ status: 'degraded', reason: 'no_index', source_sha: 'clone-head-1' });
    await app.close();
  });

  it('no pr_files -> unavailable/no_changed_files, the facade is not called and no row is written', async () => {
    const { app, state } = await appWith();
    const pr = await makePr({ files: [] });
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'unavailable', reason: 'no_changed_files', blast: null, cached: false, computed_at: null });
    expect(state.blastCalls).toHaveLength(0);
    expect(await cacheRows(pr.id)).toHaveLength(0);
    await app.close();
  });

  it('a PR from another workspace is 404 and leaks no cache row; a non-uuid id is 422', async () => {
    const { app, state } = await appWith();
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-ws' }).returning();
    const [otherRepo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: other!.id, owner: 'x', name: 'y', fullName: 'x/y' })
      .returning();
    const foreign = await makePr({ workspace: other!.id, repo: otherRepo!.id });
    const res = await app.inject({ method: 'GET', url: `/pulls/${foreign.id}/blast` });
    expect(res.statusCode).toBe(404);
    expect(state.blastCalls).toHaveLength(0);
    expect(await cacheRows(foreign.id)).toHaveLength(0);

    expect((await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/blast' })).statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: '/pulls/00000000-0000-4000-8000-000000000000/blast' })).statusCode).toBe(404);
    await app.close();
  });
});
