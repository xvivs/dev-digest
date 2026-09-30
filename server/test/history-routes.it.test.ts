/**
 * GET /pulls/:id/history end to end over a real Postgres (Testcontainers):
 * buildApp + inject, the real HistoryRepository, MockGitHubClient path history.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { GitHubClient, PathHistoryRow } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder, MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const hist = (number: number, path: string, mergedAt: string | null = '2026-05-01T00:00:00Z'): PathHistoryRow => ({
  path,
  number,
  title: `Earlier PR ${number}`,
  author: 'sam',
  mergedAt,
});

d('GET /pulls/:id/history (Testcontainers pg)', () => {
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
      .values({ workspaceId, owner: 'acme', name: 'hist-it', fullName: 'acme/hist-it' })
      .returning();
    repoId = repo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const appWith = (overrides: { github?: GitHubClient; secrets?: { get: () => Promise<undefined> } }) =>
    buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), git: new MockGitClient(), ...overrides } as never,
    });

  async function makePr(opts: { files?: string[]; workspace?: string; repo?: string; number?: number } = {}) {
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: opts.workspace ?? workspaceId,
        repoId: opts.repo ?? repoId,
        number: opts.number ?? 8000 + ++seq,
        title: 'History PR',
        author: 'sam',
        branch: 'feat',
        base: 'main',
        headSha: 'head-1',
      })
      .returning();
    const files = opts.files ?? ['src/a.ts', 'src/b.ts'];
    if (files.length > 0) {
      await pg.handle.db.insert(t.prFiles).values(files.map((path, i) => ({ prId: pr!.id, path, additions: 10 - i, deletions: 0 })));
    }
    return pr!;
  }

  const cacheRows = (prId: string) =>
    pg.handle.db.select().from(t.prHistoryCache).where(eq(t.prHistoryCache.prId, prId));

  it('returns prior merged PRs grouped by overlap, excluding the PR itself and unmerged ones, and caches the result', async () => {
    const pr = await makePr({ number: 9001 });
    const gh = new MockGitHubClient({
      pathHistory: {
        'src/a.ts': [hist(11, 'src/a.ts'), hist(9001, 'src/a.ts'), hist(12, 'src/a.ts', null)],
        'src/b.ts': [hist(11, 'src/b.ts'), hist(10, 'src/b.ts', '2026-04-01T00:00:00Z')],
      },
    });
    const app = await appWith({ github: gh });
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/history` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ status: 'ok', reason: null, cached: false, queried_paths: ['src/a.ts', 'src/b.ts'] });
    expect(body.history.map((h: { pr_number: number }) => h.pr_number)).toEqual([11, 10]);
    expect(body.history[0]).toMatchObject({ files_overlap: ['src/a.ts', 'src/b.ts'], notes: '', author: 'sam', title: 'Earlier PR 11' });
    expect(Number.isNaN(Date.parse(body.computed_at))).toBe(false);
    expect(await cacheRows(pr.id)).toHaveLength(1);

    const again = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/history` });
    expect(again.json()).toMatchObject({ status: 'ok', cached: true });
    expect(again.json().history).toEqual(body.history);
    await app.close();
  });

  it('no pr_files -> unavailable/no_changed_files, not cached', async () => {
    const pr = await makePr({ files: [] });
    const app = await appWith({ github: new MockGitHubClient() });
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/history` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'unavailable', reason: 'no_changed_files', history: [], queried_paths: [], computed_at: null });
    expect(await cacheRows(pr.id)).toHaveLength(0);
    await app.close();
  });

  it('no GitHub token -> unavailable/no_github (HTTP 200, not a 5xx), nothing cached', async () => {
    const pr = await makePr();
    const app = await appWith({ secrets: { get: async () => undefined } });
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/history` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'unavailable', reason: 'no_github', history: [] });
    expect(await cacheRows(pr.id)).toHaveLength(0);
    await app.close();
  });

  it('a GitHub failure -> unavailable/fetch_failed, and the next read retries', async () => {
    const pr = await makePr();
    const gh = new MockGitHubClient({ pathHistory: { 'src/a.ts': [hist(3, 'src/a.ts')] } });
    let fail = true;
    const orig = gh.listPathHistory.bind(gh);
    gh.listPathHistory = async (...args) => {
      if (fail) throw new Error('graphql 502');
      return orig(...args);
    };
    const app = await appWith({ github: gh });
    const first = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/history` });
    expect(first.json()).toMatchObject({ status: 'unavailable', reason: 'fetch_failed' });
    fail = false;
    const second = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/history` });
    expect(second.json()).toMatchObject({ status: 'ok', cached: false });
    expect(second.json().history).toHaveLength(1);
    await app.close();
  });

  it('a PR from another workspace is 404 and calls GitHub never; a non-uuid id is 422', async () => {
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-hist-ws' }).returning();
    const [otherRepo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: other!.id, owner: 'x', name: 'h', fullName: 'x/h' })
      .returning();
    const foreign = await makePr({ workspace: other!.id, repo: otherRepo!.id });
    const gh = new MockGitHubClient({ pathHistory: { 'src/a.ts': [hist(3, 'src/a.ts')] } });
    let called = 0;
    const orig = gh.listPathHistory.bind(gh);
    gh.listPathHistory = async (...args) => {
      called += 1;
      return orig(...args);
    };
    const app = await appWith({ github: gh });
    expect((await app.inject({ method: 'GET', url: `/pulls/${foreign.id}/history` })).statusCode).toBe(404);
    expect(called).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/pulls/nope/history' })).statusCode).toBe(422);
    await app.close();
  });
});
