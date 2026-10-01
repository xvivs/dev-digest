import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * F1 — repos data-access layer. The ONLY place that touches the `repos`
 * table. Every query is scoped by `workspaceId` (tenancy guard).
 */

export type RepoRow = typeof t.repos.$inferSelect;

export interface InsertRepo {
  workspaceId: string;
  owner: string;
  name: string;
  fullName: string;
  createdBy: string;
}

export class RepoRepository {
  constructor(private db: Db) {}

  /** Find a repo in a workspace by its `owner/name` full name (dedupe on add). */
  async findByFullName(workspaceId: string, fullName: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, fullName)));
    return row;
  }

  /** Oldest first; `id` breaks ties so the order is stable (UIs redirect to the first repo). */
  async list(workspaceId: string): Promise<RepoRow[]> {
    return this.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.workspaceId, workspaceId))
      .orderBy(asc(t.repos.createdAt), asc(t.repos.id));
  }

  async getById(workspaceId: string, id: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, id)));
    return row;
  }

  async insert(values: InsertRepo): Promise<RepoRow> {
    const [row] = await this.db
      .insert(t.repos)
      .values({
        workspaceId: values.workspaceId,
        owner: values.owner,
        name: values.name,
        fullName: values.fullName,
        createdBy: values.createdBy,
      })
      .returning();
    return row!;
  }

  /**
   * Workspace + clone path of a repo (by repo id, no tenancy scope — the
   * JobRunner's `runCloneJob` is the only caller and it already trusted the
   * payload that came out of an authenticated `add()`/`refresh()`). Read before
   * cloning so the follow-up index knows whether this was a fresh clone.
   * `undefined` if the repo was deleted before the job ran.
   */
  async getCloneBasics(
    repoId: string,
  ): Promise<{ workspaceId: string; clonePath: string | null } | undefined> {
    const [row] = await this.db
      .select({ workspaceId: t.repos.workspaceId, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row;
  }

  /** Persist the clone path and bump `last_polled_at` once a clone job completes. */
  async updateClonePath(repoId: string, clonePath: string): Promise<void> {
    await this.db
      .update(t.repos)
      .set({ clonePath, lastPolledAt: new Date() })
      .where(eq(t.repos.id, repoId));
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, id)))
      .returning({ id: t.repos.id });
    return deleted.length > 0;
  }
}
