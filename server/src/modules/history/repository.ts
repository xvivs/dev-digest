/**
 * INFRASTRUCTURE — Drizzle persistence for the history module. Owns
 * `pr_history_cache` only. Rows never leave this file.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { HistoryCacheEntry, HistoryStore } from './ports.js';

export class HistoryRepository implements HistoryStore {
  constructor(private db: Db) {}

  async get(prId: string): Promise<HistoryCacheEntry | undefined> {
    const [row] = await this.db.select().from(t.prHistoryCache).where(eq(t.prHistoryCache.prId, prId));
    return row
      ? {
          headSha: row.headSha,
          base: row.base,
          pathsHash: row.pathsHash,
          history: row.history,
          computedAt: row.computedAt,
        }
      : undefined;
  }

  async upsert(prId: string, e: Omit<HistoryCacheEntry, 'computedAt'>): Promise<void> {
    const values = {
      headSha: e.headSha,
      base: e.base,
      pathsHash: e.pathsHash,
      history: e.history,
      computedAt: new Date(),
    };
    await this.db
      .insert(t.prHistoryCache)
      .values({ prId, ...values })
      .onConflictDoUpdate({ target: t.prHistoryCache.prId, set: values });
  }
}
