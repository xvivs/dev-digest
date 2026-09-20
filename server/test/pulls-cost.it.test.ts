import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * The PR-list COST column (`PrMeta.last_run_cost_*`) surfaces the PR's LATEST
 * run — not a sum across runs — mirroring the existing `latestReviewByPr`
 * pattern in `pulls/routes.ts`. Covered here rather than in `reviews.it.test.ts`
 * because it exercises the list endpoint directly against hand-inserted
 * `agent_runs` rows, with no LLM/review pipeline in the loop.
 */
d('pulls list COST column (Testcontainers pg)', () => {
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

  function appInstance() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), git: new MockGitClient() },
    });
  }

  async function makeRepoAndPr(number: number) {
    const name = `cost-list-${repoSeq++}`;
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
        title: 'Cost column test PR',
        author: 'marisa.koch',
        branch: 'feat/x',
        base: 'main',
        headSha: 'deadbeef',
      })
      .returning();
    return { repo: repo!, pr: pr! };
  }

  it('returns the LATEST run cost, not a sum, when a PR has multiple runs', async () => {
    const app = await appInstance();
    const { repo, pr } = await makeRepoAndPr(9001);

    const now = Date.now();
    const HOUR = 3_600_000;
    await pg.handle.db.insert(t.agentRuns).values([
      {
        workspaceId,
        prId: pr.id,
        ranAt: new Date(now - 2 * HOUR), // older
        status: 'done',
        costUsd: 0.0138,
        costSource: 'estimated',
      },
      {
        workspaceId,
        prId: pr.id,
        ranAt: new Date(now - 1 * HOUR), // newer — this is the one the list must surface
        status: 'done',
        costUsd: 0.0412,
        costSource: 'provider',
      },
    ]);

    const pulls = (
      await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })
    ).json();
    const listed = pulls.find((p: { id: string }) => p.id === pr.id);
    expect(listed).toBeDefined();
    expect(listed.last_run_cost_usd).toBeCloseTo(0.0412, 5);
    expect(listed.last_run_cost_source).toBe('provider');

    await app.close();
  });

  it('a PR with no runs at all shows null, not zero or a stale value', async () => {
    const app = await appInstance();
    const { repo, pr } = await makeRepoAndPr(9002);

    const pulls = (
      await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })
    ).json();
    const listed = pulls.find((p: { id: string }) => p.id === pr.id);
    expect(listed).toBeDefined();
    expect(listed.last_run_cost_usd).toBeNull();
    expect(listed.last_run_cost_source).toBeNull();
    expect(listed.last_run_cost_missing_reason).toBeNull();

    await app.close();
  });

  it('the latest run failed with no cost → null cost with missing_reason "failed"', async () => {
    const app = await appInstance();
    const { repo, pr } = await makeRepoAndPr(9003);

    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId,
      prId: pr.id,
      ranAt: new Date(),
      status: 'failed',
      error: 'boom',
      costUsd: null,
      costSource: null,
    });

    const pulls = (
      await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })
    ).json();
    const listed = pulls.find((p: { id: string }) => p.id === pr.id);
    expect(listed.last_run_cost_usd).toBeNull();
    expect(listed.last_run_cost_missing_reason).toBe('failed');

    await app.close();
  });
});
