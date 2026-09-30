import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder, MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * PR A0 / AC-38: `GET /pulls/:id` persists the detail's `head_sha`. PR numbers
 * avoid 482 because `MockGitHubClient.listPullRequests` would rewrite that row's head.
 */
d('GET /pulls/:id persists head_sha (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appInstance(github: MockGitHubClient) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), git: new MockGitClient(), github },
    });
  }

  async function makeRepoAndPr(number: number) {
    const name = `detail-head-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number,
        title: 'Detail head test PR',
        author: 'marisa.koch',
        branch: 'feat/x',
        base: 'main',
        headSha: 'h1',
        lastReviewedSha: 'h1',
        // non-zero stats so the list's diff-stat backfill does not touch the row
        additions: 1,
        deletions: 1,
        filesCount: 1,
      })
      .returning();
    return { repo: repo!, pr: pr! };
  }

  const headOf = async (id: string) =>
    (await pg.handle.db.select().from(t.pullRequests).where(eq(t.pullRequests.id, id)))[0]!.headSha;

  it('updates head_sha from the detail and the list then shows needs_review', async () => {
    const app = await appInstance(new MockGitHubClient());
    const { repo, pr } = await makeRepoAndPr(9101);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().head_sha).toBe('a1b2c3d4');
    // Asserted before any list GET: the list sync must not be what moved it.
    expect(await headOf(pr.id)).toBe('a1b2c3d4');

    const list = await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` });
    expect(list.statusCode).toBe(200);
    const row = (list.json() as Array<{ number: number; status: string }>).find(
      (p) => p.number === 9101,
    );
    expect(row?.status).toBe('needs_review');
    await app.close();
  });

  it('leaves head_sha unchanged when the detail refresh fails', async () => {
    const gh = new MockGitHubClient();
    gh.getPullRequest = async () => {
      throw new Error('offline');
    };
    const app = await appInstance(gh);
    const { pr } = await makeRepoAndPr(9102);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}` });
    expect(res.statusCode).toBe(200);
    expect(await headOf(pr.id)).toBe('h1');
    await app.close();
  });
  async function statusOf(app: Awaited<ReturnType<typeof appInstance>>, repoId: string, number: number) {
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    expect(res.statusCode).toBe(200);
    return (res.json() as Array<{ number: number; status: string }>).find((p) => p.number === number)
      ?.status;
  }

  const rowOf = async (id: string) =>
    (await pg.handle.db.select().from(t.pullRequests).where(eq(t.pullRequests.id, id)))[0]!;

  it('flips a reviewed PR to needs_review when the refresh picks up a pushed head, keeping last_reviewed_sha', async () => {
    const app = await appInstance(new MockGitHubClient());
    const { repo, pr } = await makeRepoAndPr(9103); // head h1, reviewed at h1
    expect(await statusOf(app, repo.id, 9103)).toBe('reviewed');

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}` });
    expect(res.statusCode).toBe(200);

    expect(await statusOf(app, repo.id, 9103)).toBe('needs_review');
    const row = await rowOf(pr.id);
    expect(row.headSha).toBe('a1b2c3d4');
    expect(row.lastReviewedSha).toBe('h1'); // the refresh must not claim the new head was reviewed
    await app.close();
  });

  it('keeps a reviewed PR reviewed when the refresh reports the same head', async () => {
    const app = await appInstance(new MockGitHubClient());
    const { repo, pr } = await makeRepoAndPr(9104);
    // Reviewed at the head the mock detail will report.
    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha: 'a1b2c3d4', lastReviewedSha: 'a1b2c3d4' })
      .where(eq(t.pullRequests.id, pr.id));

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}` });
    expect(res.statusCode).toBe(200);

    expect(await statusOf(app, repo.id, 9104)).toBe('reviewed');
    const row = await rowOf(pr.id);
    expect(row.headSha).toBe('a1b2c3d4');
    expect(row.lastReviewedSha).toBe('a1b2c3d4');
    await app.close();
  });

  it('keeps a reviewed PR reviewed when the refresh fails (no head change)', async () => {
    const gh = new MockGitHubClient();
    gh.getPullRequest = async () => {
      throw new Error('offline');
    };
    const app = await appInstance(gh);
    const { repo, pr } = await makeRepoAndPr(9105);

    await app.inject({ method: 'GET', url: `/pulls/${pr.id}` });

    expect(await statusOf(app, repo.id, 9105)).toBe('reviewed');
    await app.close();
  });
});
