import { and, asc, eq } from 'drizzle-orm';
import type { Db, DbTx } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { PullRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db | DbTx,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db | DbTx,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db | DbTx,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

export async function getPrCommits(
  db: Db | DbTx,
  prId: string,
): Promise<(typeof t.prCommits.$inferSelect)[]> {
  return db
    .select()
    .from(t.prCommits)
    .where(eq(t.prCommits.prId, prId))
    .orderBy(asc(t.prCommits.committedAt), asc(t.prCommits.sha));
}

/** Persist the GitHub PR-detail refresh: body, diff stats and the current head SHA. */
export async function updateDetail(
  db: Db | DbTx,
  prId: string,
  values: { body: string | null; additions: number; deletions: number; filesCount: number; headSha: string },
): Promise<void> {
  await db.update(t.pullRequests).set(values).where(eq(t.pullRequests.id, prId));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db | DbTx, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}
