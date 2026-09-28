import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { and, eq } from 'drizzle-orm';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * The PR-list FINDINGS column (`PrMeta.last_review_findings`) — a severity
 * tally of the PR's LATEST `kind: 'review'` row, aggregated in SQL
 * (`GROUP BY review_id, severity`) and folded by `rollupSeverityRows`.
 *
 * Covered here rather than in `pulls-status.test.ts` because the interesting
 * part is the SQL + the null/zero distinction, not the pure fold: a reviewed
 * PR with no findings must report all zeros, while a never-reviewed PR must
 * report `null` so the UI renders a dash instead of "0 issues found".
 *
 * Drives the seeded `acme/payments-api` fixtures directly, so it doubles as a
 * regression test on the seed shape the client's FINDINGS states depend on.
 */
d('pulls list FINDINGS column (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let seededRepoId: string;
  let listed: Record<number, Record<string, unknown>>;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [repo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    seededRepoId = repo!.id;

    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), git: new MockGitClient() },
    });
    const pulls = (
      await app.inject({ method: 'GET', url: `/repos/${seededRepoId}/pulls` })
    ).json() as Array<Record<string, unknown> & { number: number }>;
    await app.close();

    listed = Object.fromEntries(pulls.map((p) => [p.number, p]));
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('#482 tallies all three severities of its latest review', () => {
    expect(listed[482]).toBeDefined();
    expect(listed[482]!.last_review_findings).toEqual({
      critical: 1,
      warning: 2,
      suggestion: 1,
    });
  });

  it('#477 reports zeros for the severities its single suggestion does not use', () => {
    expect(listed[477]).toBeDefined();
    expect(listed[477]!.last_review_findings).toEqual({
      critical: 0,
      warning: 0,
      suggestion: 1,
    });
  });

  it('#460 has no review at all → null, not an all-zero tally', () => {
    expect(listed[460]).toBeDefined();
    expect(listed[460]!.last_review_findings).toBeNull();
    // Same anchor as the tally: no review ⇒ no score either.
    expect(listed[460]!.score).toBeNull();
  });

  it('a review with zero findings reports all zeros, NOT null', async () => {
    // The distinction the UI leans on: `null` = never reviewed (dash),
    // all-zeros = reviewed and clean (a green "no issues" state).
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'findings-empty', fullName: 'acme/findings-empty' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 9101,
        title: 'Clean PR',
        author: 'marisa.koch',
        branch: 'feat/clean',
        base: 'main',
        headSha: 'facefeed',
      })
      .returning();
    await pg.handle.db.insert(t.reviews).values({
      workspaceId,
      prId: pr!.id,
      kind: 'review',
      verdict: 'approve',
      summary: 'Nothing to flag.',
      score: 100,
      model: 'seed',
    });

    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), git: new MockGitClient() },
    });
    const pulls = (
      await app.inject({ method: 'GET', url: `/repos/${repo!.id}/pulls` })
    ).json() as Array<{ id: string; last_review_findings: unknown }>;
    await app.close();

    const row = pulls.find((p) => p.id === pr!.id);
    expect(row).toBeDefined();
    expect(row!.last_review_findings).toEqual({ critical: 0, warning: 0, suggestion: 0 });
  });

  it('only the LATEST review anchors the tally, not every review on the PR', async () => {
    // The severity aggregate is scoped to `latestReviewIds`; an older review's
    // findings must not leak into the column.
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'findings-latest', fullName: 'acme/findings-latest' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 9102,
        title: 'Two reviews',
        author: 'marisa.koch',
        branch: 'feat/two-reviews',
        base: 'main',
        headSha: 'cafed00d',
      })
      .returning();

    const HOUR = 3_600_000;
    const now = Date.now();
    const [older] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'First pass.',
        score: 40,
        model: 'seed',
        createdAt: new Date(now - 3 * HOUR),
      })
      .returning();
    const [newer] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'comment',
        summary: 'Second pass.',
        score: 77,
        model: 'seed',
        createdAt: new Date(now - 1 * HOUR),
      })
      .returning();

    await pg.handle.db.insert(t.findings).values([
      {
        reviewId: older!.id,
        file: 'a.ts',
        startLine: 1,
        endLine: 1,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Stale critical',
        rationale: 'From the superseded review.',
        confidence: 0.9,
      },
      {
        reviewId: older!.id,
        file: 'a.ts',
        startLine: 2,
        endLine: 2,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Stale critical 2',
        rationale: 'From the superseded review.',
        confidence: 0.9,
      },
      {
        reviewId: newer!.id,
        file: 'a.ts',
        startLine: 3,
        endLine: 3,
        severity: 'WARNING',
        category: 'bug',
        title: 'Current warning',
        rationale: 'From the latest review.',
        confidence: 0.8,
      },
    ]);

    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), git: new MockGitClient() },
    });
    const pulls = (
      await app.inject({ method: 'GET', url: `/repos/${repo!.id}/pulls` })
    ).json() as Array<{ id: string; score: number | null; last_review_findings: unknown }>;
    await app.close();

    const row = pulls.find((p) => p.id === pr!.id);
    expect(row!.last_review_findings).toEqual({ critical: 0, warning: 1, suggestion: 0 });
    // Score and tally hang off the same anchor — they can never describe
    // different reviews.
    expect(row!.score).toBe(77);
  });

  it('re-seeding does not duplicate the new PRs, their reviews or their findings', async () => {
    // `pnpm db:seed` is documented as idempotent and is re-run by hand often.
    // Each new PR sits behind its own `if (!pr)` guard and the review→run link
    // behind `isNull(run_id)`, so a second pass must be a no-op.
    const countRows = async () => {
      const prs = await pg.handle.db
        .select()
        .from(t.pullRequests)
        .where(eq(t.pullRequests.repoId, seededRepoId));
      const reviews = await pg.handle.db.select().from(t.reviews);
      const findings = await pg.handle.db.select().from(t.findings);
      return { prs: prs.length, reviews: reviews.length, findings: findings.length };
    };

    const before = await countRows();
    await seed(pg.handle.db);
    expect(await countRows()).toEqual(before);
    expect(before.prs).toBe(4);
  });

  it('seeds the review→run link so the timeline and the run drawer join up', async () => {
    const [pr482] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, seededRepoId), eq(t.pullRequests.number, 482)));
    const [review] = await pg.handle.db
      .select()
      .from(t.reviews)
      .where(and(eq(t.reviews.prId, pr482!.id), eq(t.reviews.kind, 'review')));

    expect(review!.runId).not.toBeNull();
    const [run] = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.id, review!.runId!));
    expect(run!.status).toBe('done');
    // The run's own counters must agree with the review they are linked to.
    expect(run!.findingsCount).toBe(4);
    expect(run!.score).toBe(review!.score);
  });
});
