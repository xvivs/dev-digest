/**
 * INFRASTRUCTURE — Drizzle persistence for the blast module. Owns
 * `pr_blast_cache` only. Rows never leave this file.
 */
import { eq } from 'drizzle-orm';
import type { BlastReason } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { BlastCacheEntry, BlastStore } from './ports.js';

function toEntry(r: typeof t.prBlastCache.$inferSelect): BlastCacheEntry {
  return {
    headSha: r.headSha,
    sourceSha: r.sourceSha,
    indexerVersion: r.indexerVersion,
    indexStatus: r.indexStatus,
    repoIntelEnabled: r.repoIntelEnabled,
    status: r.status,
    // This repository is the only writer; the column holds a BlastReason or null.
    reason: r.reason as BlastReason | null,
    blast: r.blast,
    truncated: r.truncated,
    computedAt: r.computedAt,
  };
}

export class BlastRepository implements BlastStore {
  constructor(private db: Db) {}

  async get(prId: string): Promise<BlastCacheEntry | undefined> {
    const [row] = await this.db.select().from(t.prBlastCache).where(eq(t.prBlastCache.prId, prId));
    return row ? toEntry(row) : undefined;
  }

  async upsert(prId: string, e: Omit<BlastCacheEntry, 'computedAt'>): Promise<void> {
    const values = {
      headSha: e.headSha,
      sourceSha: e.sourceSha,
      indexerVersion: e.indexerVersion,
      indexStatus: e.indexStatus,
      repoIntelEnabled: e.repoIntelEnabled,
      status: e.status,
      reason: e.reason,
      blast: e.blast,
      truncated: e.truncated,
      computedAt: new Date(),
    };
    await this.db
      .insert(t.prBlastCache)
      .values({ prId, ...values })
      .onConflictDoUpdate({ target: t.prBlastCache.prId, set: values });
  }
}
