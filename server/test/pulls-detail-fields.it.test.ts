import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder, MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * `ReviewRepository.updatePullDetail` (via GET /pulls/:id): the detail refresh
 * writes body, diff stats and head to THAT PR's row only. The head/status half
 * is covered by pulls-detail-head.it.test.ts; this covers the other columns.
 */
d('GET /pulls/:id persists body and diff stats (Testcontainers pg)', () => {
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
      .values({ workspaceId, owner: 'acme', name: 'detail-fields', fullName: 'acme/detail-fields' })
      .returning();
    repoId = repo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const app = (github: MockGitHubClient) =>
    buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), git: new MockGitClient(), github },
    });

  async function makePr(over: Partial<typeof t.pullRequests.$inferInsert> = {}) {
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 9300 + ++seq,
        title: 'Keep my title',
        author: 'sam',
        branch: 'feat/keep',
        base: 'main',
        headSha: 'h1',
        body: 'old body',
        additions: 1,
        deletions: 1,
        filesCount: 1,
        ...over,
      })
      .returning();
    return pr!;
  }
  const rowOf = async (id: string) =>
    (await pg.handle.db.select().from(t.pullRequests).where(eq(t.pullRequests.id, id)))[0]!;

  it('writes body, additions, deletions and files_count from the detail, leaves other columns, and touches no other PR', async () => {
    const target = await makePr();
    const neighbour = await makePr({ body: 'neighbour body', additions: 5, deletions: 6, filesCount: 7 });
    const a = await app(new MockGitHubClient({ detail: { body: 'fresh body from GitHub', additions: 11, deletions: 22, files_count: 3 } }));

    expect((await a.inject({ method: 'GET', url: `/pulls/${target.id}` })).statusCode).toBe(200);

    const row = await rowOf(target.id);
    expect(row).toMatchObject({ body: 'fresh body from GitHub', additions: 11, deletions: 22, filesCount: 3, headSha: 'a1b2c3d4' });
    expect(row).toMatchObject({ title: 'Keep my title', branch: 'feat/keep', lastReviewedSha: null });

    expect(await rowOf(neighbour.id)).toMatchObject({ body: 'neighbour body', additions: 5, deletions: 6, filesCount: 7, headSha: 'h1' });
    await a.close();
  });

  it('a detail without a body clears it to NULL rather than keeping the old text', async () => {
    const pr = await makePr();
    const a = await app(new MockGitHubClient({ detail: { body: null } }));
    await a.inject({ method: 'GET', url: `/pulls/${pr.id}` });
    expect((await rowOf(pr.id)).body).toBeNull();
    await a.close();
  });

  it('a failed refresh leaves body and stats untouched', async () => {
    const gh = new MockGitHubClient();
    gh.getPullRequest = async () => {
      throw new Error('offline');
    };
    const pr = await makePr();
    const a = await app(gh);
    await a.inject({ method: 'GET', url: `/pulls/${pr.id}` });
    expect(await rowOf(pr.id)).toMatchObject({ body: 'old body', additions: 1, deletions: 1, filesCount: 1, headSha: 'h1' });
    await a.close();
  });
});
