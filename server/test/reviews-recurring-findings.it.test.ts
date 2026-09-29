import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/**
 * `ReviewRepository.recurringFindings` — the review-history evidence feed for
 * the conventions extractor: findings of ONE repo, non-dismissed, grouped by
 * `(category, lower(trim(title)))`, kept when they span >= minPrs distinct PRs.
 */
d('ReviewRepository.recurringFindings (Testcontainers pg)', () => {
  let pg: PgFixture;
  let repo: ReviewRepository;
  let repoId: string;
  let otherRepoId: string;

  beforeAll(async () => {
    pg = await startPg();
    const db = pg.handle.db;
    repo = new ReviewRepository(db);
    const [ws] = await db.insert(t.workspaces).values({ name: 'rf-ws' }).returning();
    const workspaceId = ws!.id;
    const mkRepo = async (name: string) => {
      const [r] = await db
        .insert(t.repos)
        .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
        .returning();
      return r!.id;
    };
    repoId = await mkRepo('main-repo');
    otherRepoId = await mkRepo('other-repo');

    const mkPr = async (rid: string, number: number) => {
      const [p] = await db
        .insert(t.pullRequests)
        .values({ workspaceId, repoId: rid, number, title: `PR ${number}`, author: 'a', branch: 'b', base: 'main', headSha: 'sha' })
        .returning();
      const [rv] = await db
        .insert(t.reviews)
        .values({ workspaceId, prId: p!.id, kind: 'review' })
        .returning();
      return rv!.id;
    };
    const mkFinding = (reviewId: string, o: { category: string; title: string; file: string; dismissed?: boolean }) =>
      db.insert(t.findings).values({
        reviewId,
        file: o.file,
        startLine: 1,
        endLine: 2,
        severity: 'warning',
        category: o.category,
        title: o.title,
        rationale: 'r',
        confidence: 0.9,
        dismissedAt: o.dismissed ? new Date() : null,
      });

    const r1 = await mkPr(repoId, 1);
    const r2 = await mkPr(repoId, 2);
    const r3 = await mkPr(repoId, 3);
    const o1 = await mkPr(otherRepoId, 1);
    const o2 = await mkPr(otherRepoId, 2);

    // Recurs in 3 PRs; title case/whitespace differ; two findings in PR 1 count once.
    await mkFinding(r1, { category: 'style', title: 'Missing await', file: 'a.ts' });
    await mkFinding(r1, { category: 'style', title: 'Missing await', file: 'b.ts' });
    await mkFinding(r2, { category: 'style', title: '  missing AWAIT ', file: 'a.ts' });
    await mkFinding(r3, { category: 'style', title: 'missing await', file: 'c.ts' });
    // Recurs in 2 PRs.
    await mkFinding(r1, { category: 'security', title: 'Unsanitised input', file: 'x.ts' });
    await mkFinding(r2, { category: 'security', title: 'Unsanitised input', file: 'y.ts' });
    // One PR only -> below threshold.
    await mkFinding(r1, { category: 'perf', title: 'N+1 query', file: 'p.ts' });
    // Same title, different category -> separate group; dismissed in 2 of 3 -> 1 PR left.
    await mkFinding(r1, { category: 'bug', title: 'Off by one', file: 'z.ts' });
    await mkFinding(r2, { category: 'bug', title: 'Off by one', file: 'z.ts', dismissed: true });
    await mkFinding(r3, { category: 'bug', title: 'Off by one', file: 'z.ts', dismissed: true });
    // Other repo must never leak in.
    await mkFinding(o1, { category: 'style', title: 'Missing await', file: 'other.ts' });
    await mkFinding(o2, { category: 'style', title: 'Missing await', file: 'other.ts' });
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('groups case/whitespace-insensitively, counts distinct PRs, excludes dismissed and other repos', async () => {
    const rows = await repo.recurringFindings(repoId, 2, 10);
    expect(rows.map((r) => [r.category, r.prCount])).toEqual([
      ['style', 3],
      ['security', 2],
    ]);
    const style = rows[0]!;
    expect(style.title.trim().toLowerCase()).toBe('missing await');
    expect([...style.files].sort()).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('honours minPrs and limit', async () => {
    expect((await repo.recurringFindings(repoId, 3, 10)).map((r) => r.category)).toEqual(['style']);
    expect((await repo.recurringFindings(repoId, 2, 1)).map((r) => r.category)).toEqual(['style']);
    expect(await repo.recurringFindings(repoId, 4, 10)).toEqual([]);
  });
});
